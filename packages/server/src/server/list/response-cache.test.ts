/**
 * Unit tests for the shared list response cache.
 *
 * Why these matter: this module is now the read path for both chain-scoped list
 * endpoints, so a defect here is a defect in every token list the service serves. The
 * three properties worth pinning are the ones that are invisible when they break — a
 * cache hit that still runs the query is merely slow, an awaited cache write couples
 * response latency to a multi-megabyte INSERT, and a failed write that propagates
 * turns a servable body into a 500. None of them announce themselves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../db', () => ({
  getCachedRequest: vi.fn(),
  insertCacheRequest: vi.fn(),
}))
// src/utils instantiates the Ink terminal renderer at module load, which cannot run
// under vitest (patch-console). An endlessly-chainable no-op stands in.
vi.mock('../../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import * as db from '../../db'
import {
  FRESH_TTL_MS,
  STALE_TTL_MS,
  buildAndCache,
  cacheRowAge,
  listCacheControl,
  serveCachedJson,
  writeCachedResponse,
} from './response-cache'

/** A promise whose resolution the test controls. */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const mockResponse = () => ({
  set: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
})

beforeEach(() => {
  vi.mocked(db.getCachedRequest)
    .mockReset()
    .mockResolvedValue(undefined as never)
  vi.mocked(db.insertCacheRequest)
    .mockReset()
    .mockResolvedValue(undefined as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('listCacheControl', () => {
  it('lets a content delivery network serve stale for a day while a rebuild happens', () => {
    // The server's own cacheSeconds is a day in production. Handing that to a content
    // delivery network as max-age would pin a token list for a full day with no way to
    // correct it, which is why this header is computed from the collection cadence
    // instead: fresh for one run, stale-but-servable for a day after.
    expect(listCacheControl).toBe(
      `public, max-age=${FRESH_TTL_MS / 1000}, stale-while-revalidate=${STALE_TTL_MS / 1000}`,
    )
  })
})

describe('cacheRowAge', () => {
  it('derives age zero from a row written this instant', () => {
    vi.useFakeTimers({ now: 1_750_000_000_000 })
    expect(cacheRowAge({ expiresAt: new Date(Date.now() + STALE_TTL_MS) })).toBe(0)
  })

  it('derives the elapsed time since the row was written', () => {
    vi.useFakeTimers({ now: 1_750_000_000_000 })
    const writtenAgoMs = 5 * 60 * 1000
    expect(cacheRowAge({ expiresAt: new Date(Date.now() - writtenAgoMs + STALE_TTL_MS) })).toBe(writtenAgoMs)
  })
})

describe('writeCachedResponse', () => {
  it('persists with expiresAt exactly one stale window from now', async () => {
    vi.useFakeTimers({ now: 1_750_000_000_000 })
    await writeCachedResponse('key-1', 'body-1')
    expect(db.insertCacheRequest).toHaveBeenCalledWith({
      key: 'key-1',
      value: 'body-1',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    })
  })
})

describe('buildAndCache', () => {
  it('shares one build across concurrent callers of the same key', async () => {
    const gate = deferred<string>()
    const build = vi.fn(() => gate.promise)

    const first = buildAndCache('key-1', build)
    const second = buildAndCache('key-1', build)
    gate.resolve('body')

    expect(await first).toBe('body')
    expect(await second).toBe('body')
    expect(build).toHaveBeenCalledTimes(1)
    expect(db.insertCacheRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct keys independent', async () => {
    const build = vi.fn(async () => 'body')

    await Promise.all([buildAndCache('key-1', build), buildAndCache('key-2', build)])

    expect(build).toHaveBeenCalledTimes(2)
  })

  it('releases the key once the build settles, so a later caller rebuilds', async () => {
    const build = vi.fn(async () => 'body')

    await buildAndCache('key-1', build)
    await buildAndCache('key-1', build)

    // Otherwise the very first body for a key would be served forever, and the
    // background revalidation path could never replace it.
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('answers with the body even when the cache write fails', async () => {
    vi.mocked(db.insertCacheRequest).mockRejectedValue(new Error('disk full') as never)

    // A cache write is an optimization. Failing it means the next caller rebuilds,
    // which is a cost — turning it into a 500 would be a failure.
    await expect(buildAndCache('key-1', async () => 'body')).resolves.toBe('body')
  })

  it('does not wait on the cache write before returning the body', async () => {
    // Never resolved. If the body waited on the write, this test would time out
    // rather than fail — which is exactly the shape of the production symptom.
    const write = deferred<undefined>()
    vi.mocked(db.insertCacheRequest).mockReturnValue(write.promise as never)

    // A cold caller already holds the bytes; making it wait on a multi-megabyte
    // INSERT adds latency to a response that is otherwise ready to send.
    await expect(buildAndCache('key-1', async () => 'body')).resolves.toBe('body')
  })
})

describe('serveCachedJson', () => {
  const options = (overrides: Partial<Parameters<typeof serveCachedJson>[1]> = {}) => ({
    cacheKey: 'key-1',
    build: vi.fn(async () => '{"tokens":[]}'),
    cacheControl: listCacheControl,
    ...overrides,
  })

  it('serves a hit without building', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":["cached"]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)
    const res = mockResponse()
    const opts = options()

    await serveCachedJson(res as never, opts)

    expect(opts.build).not.toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith('{"tokens":["cached"]}')
    expect(res.set).toHaveBeenCalledWith('cache-control', listCacheControl)
  })

  it('serves a stale hit immediately and rebuilds behind the response', async () => {
    // The caller who happens to arrive at the moment of expiry should not be the one
    // who pays for the rebuild — that is the whole point of a stale window.
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":["stale"]}',
      expiresAt: new Date(Date.now() - FRESH_TTL_MS - 1_000 + STALE_TTL_MS),
    } as never)
    const res = mockResponse()
    const opts = options({ cacheKey: 'stale-key' })

    await serveCachedJson(res as never, opts)

    expect(res.send).toHaveBeenCalledWith('{"tokens":["stale"]}')
    expect(opts.build).toHaveBeenCalledTimes(1)
  })

  it('builds on a miss and sends what it built', async () => {
    const res = mockResponse()
    const opts = options({ cacheKey: 'miss-key' })

    await serveCachedJson(res as never, opts)

    expect(opts.build).toHaveBeenCalledTimes(1)
    expect(res.send).toHaveBeenCalledWith('{"tokens":[]}')
    expect(db.insertCacheRequest).toHaveBeenCalled()
  })

  it('skips the read but still rewrites the row when the cache is bypassed', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":["stale"]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)
    const res = mockResponse()
    const opts = options({ cacheKey: 'bypass-key', bypassCache: true, bypassCacheControl: 'no-store' })

    await serveCachedJson(res as never, opts)

    expect(db.getCachedRequest).not.toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith('{"tokens":[]}')
    // The rewrite is what makes a refresh worth gating behind an admin token: it
    // repairs the body for everyone, not just for the caller who asked.
    expect(db.insertCacheRequest).toHaveBeenCalled()
    expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
  })

  it('leaves the response untouched when the build throws', async () => {
    const res = mockResponse()
    const opts = options({
      cacheKey: 'throw-key',
      build: vi.fn(async () => {
        throw new Error('query timeout')
      }),
    })

    // The caller's error handler owns the response from here. Half-writing one would
    // hand the client a 200 with no body.
    await expect(serveCachedJson(res as never, opts)).rejects.toThrow('query timeout')
    expect(res.send).not.toHaveBeenCalled()
  })
})
