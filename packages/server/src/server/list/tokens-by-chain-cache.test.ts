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

vi.mock('../../db', async () => {
  // Real normalizeProvidedId (isAddress ? lower : preserve) — buildTokensByChainResponse
  // uses it to key its sources map, and stubbing it to undefined would throw.
  const { normalizeProvidedId } = await vi.importActual<typeof import('../../db/provided-id')>('../../db/provided-id')
  return {
    getTokensByChainRanked: vi.fn(),
    getTokenSourcesByChain: vi.fn(),
    getTokensUnderListId: vi.fn(),
    insertCacheRequest: vi.fn(),
    getCachedRequest: vi.fn(),
    getListOrderId: vi.fn(),
    applyOrder: vi.fn(),
    getLists: vi.fn(),
    normalizeProvidedId,
  }
})
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
import { getDefaultListOrderId } from '../../db/sync-order'
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

  // A ranked token row with no usable image (no imageHash/ext, mode !== link)
  // must not surface — the endpoint exists to hand the UI something to render.
  const imagelessToken = {
    chainId: 'eip155-1',
    providedId: '0x2222222222222222222222222222222222222222',
    decimals: 18,
    symbol: 'NOI',
    name: 'No Image',
    imageHash: null,
    ext: null,
    mode: 'save',
    uri: null,
    providerKey: 'pulsex',
    listKey: 'extended',
  }
  const imagedToken = (overrides: Record<string, unknown> = {}) => ({
    chainId: 'eip155-1',
    providedId: '0x1111111111111111111111111111111111111111',
    decimals: 18,
    symbol: 'TST',
    name: 'Test Token',
    imageHash: 'hash1',
    ext: '.png',
    mode: 'save',
    uri: null,
    providerKey: 'pulsex',
    listKey: 'extended',
    ...overrides,
  })

  it('filters out ranked tokens with no usable image', async () => {
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([imagedToken(), imagelessToken] as never)
    const body = await buildAndCacheTokensByChain('eip155-1', 50_000)
    const parsed = JSON.parse(body)
    expect(parsed.total).toBe(1)
    expect(parsed.tokens).toHaveLength(1)
    expect(parsed.tokens[0].address).toBe('0x1111111111111111111111111111111111111111')
  })

  it('patches the full multi-provider source list onto each entry, keyed by normalized address', async () => {
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([imagedToken()] as never)
    vi.mocked(db.getTokenSourcesByChain).mockResolvedValue([
      {
        providedId: '0x1111111111111111111111111111111111111111',
        providerKey: 'pulsex',
        listKey: 'extended',
      },
      // Same token, a second list carrying it — exercises the "existing" append
      // branch rather than always creating a fresh single-entry array.
      {
        providedId: '0x1111111111111111111111111111111111111111',
        providerKey: 'piteas',
        listKey: 'default',
      },
    ] as never)

    const body = await buildAndCacheTokensByChain('eip155-1', 50_000)
    const parsed = JSON.parse(body)
    expect(parsed.tokens[0].sources).toEqual(['pulsex/extended', 'piteas/default'])
  })

  // When no default list order has been computed yet (e.g. very early at
  // startup), the ranked query has nothing to rank against — the response
  // falls back to the unordered per-list-token query instead.
  it('falls back to the unordered query when no default list order id exists yet', async () => {
    vi.mocked(getDefaultListOrderId).mockReturnValueOnce(null as never)
    const fallbackWhere = vi.fn().mockResolvedValue([imagedToken()])
    vi.mocked(db.getTokensUnderListId).mockReturnValue({ where: fallbackWhere } as never)

    const body = await buildAndCacheTokensByChain('eip155-1', 50_000)

    expect(fallbackWhere).toHaveBeenCalled()
    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
    // Source rows are skipped too — getTokenSourcesByChain has nothing to key against.
    expect(db.getTokenSourcesByChain).not.toHaveBeenCalled()
    expect(JSON.parse(body).tokens).toHaveLength(1)
  })

  it('leaves an entry without a matching source row untouched (no sources patched on)', async () => {
    // No providerKey/listKey on the row itself, so normalizeTokens' own
    // same-row sources derivation stays empty too — isolating the sourcesMap
    // patch step, whose lookup is expected to miss here.
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([
      imagedToken({ providerKey: undefined, listKey: undefined }),
    ] as never)
    // Source rows reference a different token entirely — the map lookup misses.
    vi.mocked(db.getTokenSourcesByChain).mockResolvedValue([
      { providedId: '0x9999999999999999999999999999999999999999', providerKey: 'pulsex', listKey: 'extended' },
    ] as never)

    const body = await buildAndCacheTokensByChain('eip155-1', 50_000)
    const parsed = JSON.parse(body)
    expect(parsed.tokens[0].sources).toBeUndefined()
  })
})

describe('warmTokensByChainCache', () => {
  beforeEach(resetDbMocks)

  it('rebuilds only the top N chains by token count', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([] as never)

    const { warmTokensByChainCache } = await import('./handlers')
    const stats = [
      { chainId: 'eip155-1', count: 5000 },
      { chainId: 'eip155-369', count: 4000 },
      { chainId: 'eip155-56', count: 3000 },
    ]
    await warmTokensByChainCache(stats, 2)

    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
    expect(db.getTokensByChainRanked).toHaveBeenCalledWith('eip155-1', '0xdefaultorder')
    expect(db.getTokensByChainRanked).toHaveBeenCalledWith('eip155-369', '0xdefaultorder')
  })

  it('skips a chain whose cache row is already fresh (younger than the warm-stale threshold)', async () => {
    const { warmTokensByChainCache } = await import('./handlers')
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{}',
      // Written moments ago — well under the 12-hour warm-stale threshold.
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)

    await warmTokensByChainCache([{ chainId: 'eip155-1', count: 5000 }], 5)

    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
  })

  it('rebuilds a chain whose cache row exists but has crossed the warm-stale threshold', async () => {
    const { warmTokensByChainCache } = await import('./handlers')
    const WARM_STALE_MS = 12 * 60 * 60 * 1000
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{}',
      // expiresAt = createdAt + STALE_TTL_MS, so subtracting more than the warm
      // threshold from expiresAt simulates a row written long enough ago to warm again.
      expiresAt: new Date(Date.now() + STALE_TTL_MS - WARM_STALE_MS - 1000),
    } as never)
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([] as never)

    await warmTokensByChainCache([{ chainId: 'eip155-1', count: 5000 }], 5)

    expect(db.getTokensByChainRanked).toHaveBeenCalledWith('eip155-1', '0xdefaultorder')
  })

  it('is best-effort — an error rebuilding one chain must not stop the rest from warming', async () => {
    const { warmTokensByChainCache } = await import('./handlers')
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getTokensByChainRanked)
      .mockRejectedValueOnce(new Error('query timeout'))
      .mockResolvedValueOnce([] as never)

    await expect(
      warmTokensByChainCache(
        [
          { chainId: 'eip155-1', count: 5000 },
          { chainId: 'eip155-369', count: 4000 },
        ],
        5,
      ),
    ).resolves.toBeUndefined()

    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
  })
})
