/**
 * Unit tests for the tokensByChain cache contract and single-flight build.
 *
 * Why these matter: the cache key, TTL arithmetic, and build deduplication are
 * the contract between three independent callers (cold requests, background
 * revalidation, the periodic warmer). Drift in the key means the warmer warms
 * rows no request reads; a broken single-flight means concurrent cold hits each
 * pay the multi-second ranked query; an awaited cache write would couple
 * response latency to a multi-megabyte INSERT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../db', () => ({
  getTokensByChainRanked: vi.fn(),
  getTokenSourcesByChain: vi.fn(),
  getTokensUnderListId: vi.fn(),
  insertCacheRequest: vi.fn(),
  getCachedRequest: vi.fn(),
  getListOrderId: vi.fn(),
  applyOrder: vi.fn(),
  getLists: vi.fn(),
}))
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
vi.mock('../../db/sync-order', () => ({ getDefaultListOrderId: vi.fn(() => '0xdefaultorder') }))
vi.mock('../../collect/user-submissions', () => ({ bumpSubscriberCount: vi.fn() }))
// src/utils instantiates the Ink terminal renderer at module load, which cannot
// run under vitest (patch-console). An endlessly-chainable no-op stands in.
vi.mock('../../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import * as db from '../../db'
import { tokensByChainCacheKey, cacheRowAge, writeTokensByChainCache, buildAndCacheTokensByChain } from './handlers'

const STALE_TTL_MS = 24 * 60 * 60 * 1000

/** A promise whose resolution the test controls. */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const resetDbMocks = () => {
  vi.mocked(db.getTokensByChainRanked).mockReset()
  vi.mocked(db.getTokenSourcesByChain).mockReset().mockResolvedValue([])
  vi.mocked(db.insertCacheRequest)
    .mockReset()
    .mockResolvedValue(undefined as never)
}

describe('tokensByChainCacheKey', () => {
  it('keeps the legacy trailing-colon shape so rows warmed before the extensions removal stay readable', () => {
    // Extensions were dropped from the key (they never changed the output —
    // the ranked query selects no bridge/header columns) but the empty
    // extensions slot must keep its position or every warmed row goes cold.
    expect(tokensByChainCacheKey('eip155-1', 50_000)).toBe('tokens-by-chain:eip155-1:50000:')
  })

  it('keys only on chainId and limit — ?extensions= can no longer fork the cache', () => {
    expect(tokensByChainCacheKey('eip155-1', 100)).toBe('tokens-by-chain:eip155-1:100:')
  })

  it('keys on the limit, so different limits never share a cached body', () => {
    expect(tokensByChainCacheKey('eip155-1', 100)).not.toBe(tokensByChainCacheKey('eip155-1', 200))
  })
})

describe('cacheRowAge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives age zero from a row written this instant', () => {
    vi.useFakeTimers({ now: 1_750_000_000_000 })
    const row = { expiresAt: new Date(Date.now() + STALE_TTL_MS) }
    expect(cacheRowAge(row)).toBe(0)
  })

  it('derives the elapsed time since the row was written', () => {
    vi.useFakeTimers({ now: 1_750_000_000_000 })
    const writtenAgoMs = 5 * 60 * 1000
    const row = { expiresAt: new Date(Date.now() - writtenAgoMs + STALE_TTL_MS) }
    expect(cacheRowAge(row)).toBe(writtenAgoMs)
  })
})

describe('writeTokensByChainCache', () => {
  beforeEach(resetDbMocks)

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists with expiresAt exactly one stale window from now', async () => {
    vi.useFakeTimers({ now: 1_750_000_000_000 })
    await writeTokensByChainCache('key-1', 'body-1')
    expect(db.insertCacheRequest).toHaveBeenCalledTimes(1)
    expect(db.insertCacheRequest).toHaveBeenCalledWith({
      key: 'key-1',
      value: 'body-1',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    })
  })
})

describe('buildAndCacheTokensByChain', () => {
  beforeEach(resetDbMocks)

  it('shares one query pass and one cache write across concurrent callers of the same key', async () => {
    const ranked = deferred<Record<string, unknown>[]>()
    vi.mocked(db.getTokensByChainRanked).mockReturnValue(ranked.promise)

    const first = buildAndCacheTokensByChain('eip155-1', 50_000)
    const second = buildAndCacheTokensByChain('eip155-1', 50_000)

    ranked.resolve([])
    const [bodyA, bodyB] = await Promise.all([first, second])

    expect(bodyA).toBe(bodyB)
    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(1)
    expect(db.insertCacheRequest).toHaveBeenCalledTimes(1)
  })

  it('does not share builds across different cache keys', async () => {
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([])
    await Promise.all([
      buildAndCacheTokensByChain('eip155-1', 50_000),
      buildAndCacheTokensByChain('eip155-369', 50_000),
    ])
    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight entry after settling so the next caller rebuilds', async () => {
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([])
    await buildAndCacheTokensByChain('eip155-1', 50_000)
    await buildAndCacheTokensByChain('eip155-1', 50_000)
    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
  })

  it('propagates a build failure to every concurrent caller, then allows a retry', async () => {
    const ranked = deferred<Record<string, unknown>[]>()
    vi.mocked(db.getTokensByChainRanked).mockReturnValueOnce(ranked.promise).mockResolvedValueOnce([])

    const first = buildAndCacheTokensByChain('eip155-1', 50_000)
    const second = buildAndCacheTokensByChain('eip155-1', 50_000)
    ranked.reject(new Error('query timeout'))

    await expect(first).rejects.toThrow('query timeout')
    await expect(second).rejects.toThrow('query timeout')
    // The failed promise must not be cached — the next demand re-queries.
    await expect(buildAndCacheTokensByChain('eip155-1', 50_000)).resolves.toBeTypeOf('string')
    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
  })

  it('resolves the body without waiting for the cache write, and survives its failure', async () => {
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([])
    const write = deferred<undefined>()
    vi.mocked(db.insertCacheRequest).mockReturnValue(write.promise as never)

    // The body must arrive while the INSERT is still pending (fire-and-forget) —
    // a cold request never waits on the multi-megabyte cache write.
    const body = await buildAndCacheTokensByChain('eip155-1', 50_000)
    expect(JSON.parse(body)).toMatchObject({ chainIdentifier: 'eip155-1', total: 0, tokens: [] })

    // A failing write must not surface anywhere (logged, not thrown).
    write.reject(new Error('disk full'))
    await new Promise((resolve) => setImmediate(resolve))
  })
})
