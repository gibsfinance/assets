import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
// The harness's `limitBy` stands in as a bare `(items, fn) => Promise<...>`
// function, but the real `@gibs/utils` `limitBy` returns a `promise-limit`
// instance with a `.map(items, fn)` method that respects the requested
// concurrency — which is how jupiter.ts actually calls it, and which matters
// here: a naive `Promise.all` shim starts every item before any of them can
// observe a mid-run abort. Worth upstreaming; rebuilt locally in the meantime.
// See the report for the exact gap.
vi.mock('@gibs/utils', () => ({
  ...harness.gibsUtilsModule,
  limitBy: <T>(_key: string, count = 16) => ({
    map: async (items: T[], fn: (item: T) => Promise<unknown>) => {
      const results: unknown[] = new Array(items.length)
      let nextIndex = 0
      const worker = async () => {
        while (nextIndex < items.length) {
          const current = nextIndex
          nextIndex += 1
          results[current] = await fn(items[current])
        }
      }
      await Promise.all(Array.from({ length: Math.min(count, items.length) }, worker))
      return results
    },
  }),
}))
vi.mock('../fetch', () => ({ fetch: fetchMock }))

beforeEach(() => {
  harness.reset()
  fetchMock.mockReset()
})

import jupiter, { collect } from './jupiter'

const VERIFIED_URL = 'https://lite-api.jup.ag/tokens/v2/tag?query=verified'
const TOP_TRADED_URL = 'https://lite-api.jup.ag/tokens/v2/toptraded/24h'
const TOP_TRENDING_URL = 'https://lite-api.jup.ag/tokens/v2/toptrending/24h'
const TOP_ORGANIC_URL = 'https://lite-api.jup.ag/tokens/v2/toporganicscore/24h'
const RECENT_URL = 'https://lite-api.jup.ag/tokens/v2/recent'

/** Base-58-only unique mint addresses (32-44 chars, no 0/O/I/l), one per call. */
let mintCounter = 0
const mintAddress = (): string => {
  mintCounter += 1
  let n = mintCounter
  let digits = ''
  while (n > 0) {
    digits = String((n % 9) + 1) + digits
    n = Math.floor(n / 9)
  }
  return `Mint${digits}`.padEnd(32, '9')
}

const rawToken = (overrides: Record<string, unknown> = {}) => ({
  id: mintAddress(),
  name: 'Fixture Token',
  symbol: 'FIX',
  decimals: 6,
  icon: 'https://example.com/icon.png',
  tags: ['verified'],
  ...overrides,
})

const jsonResponse = (body: unknown) => ({ json: async () => body }) as Response

/** `MIN_LIST_SIZE` worth (or more, or fewer) of raw tokens sharing the given tags. */
const rawTokens = (count: number, tags: string[]) => Array.from({ length: count }, () => rawToken({ tags }))

describe('jupiter collector', () => {
  // Runs before any other test calls discover(), so the module-level collector
  // instance still has its pristine, never-discovered private state.
  it('does nothing when collect() runs before discover() has prepared any lists', async () => {
    await jupiter.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('splits the verified universe into one list per meaningful tag with enough tokens, and skips undersized tags', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, [
      ...rawTokens(6, ['verified']), // >= MIN_LIST_SIZE, list created
      ...rawTokens(3, ['verified', 'lst']), // lst alone is < MIN_LIST_SIZE, skipped
    ] as never)
    fetchMock.mockResolvedValue(jsonResponse([]))

    const manifest = await jupiter.discover(new AbortController().signal)

    const listKeys = manifest[0]?.lists.map((list) => list.listKey) ?? []
    expect(listKeys).toContain('tag-verified')
    expect(listKeys).not.toContain('tag-lst')
    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['jupiter'])
    expect(harness.state.networks.has('solana-501')).toBe(true)
  })

  it('adds one list per dynamic category feed that clears the minimum size, tolerating a feed that fails to fetch', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    fetchMock.mockImplementation(async (url: string) => {
      if (url === TOP_TRADED_URL) return jsonResponse(rawTokens(5, ['verified']))
      if (url === TOP_TRENDING_URL) return jsonResponse(rawTokens(3, ['verified'])) // below MIN_LIST_SIZE
      if (url === TOP_ORGANIC_URL) throw new Error('feed unreachable')
      if (url === RECENT_URL) return jsonResponse(rawTokens(5, ['verified']))
      throw new Error(`unexpected url ${url}`)
    })

    const manifest = await jupiter.discover(new AbortController().signal)

    const listKeys = manifest[0]?.lists.map((list) => list.listKey) ?? []
    expect(listKeys).toContain('top-traded-24h')
    expect(listKeys).not.toContain('top-trending-24h')
    expect(listKeys).not.toContain('top-organic-24h')
    expect(listKeys).toContain('recent')
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o source=%o error=%o',
      'jupiter',
      'top-organic-24h',
      'feed unreachable',
    )
  })

  it('stops fetching further category feeds once the signal aborts mid-loop', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    const controller = new AbortController()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === TOP_TRADED_URL) {
        controller.abort()
        return jsonResponse(rawTokens(5, ['verified']))
      }
      throw new Error(`should not fetch ${url} after abort`)
    })

    await jupiter.discover(controller.signal)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('produces no lists and stops early when the verified fetch itself is aborted', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    const controller = new AbortController()
    controller.abort()

    const manifest = await jupiter.discover(controller.signal)

    expect(manifest).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('produces no lists when the verified universe yields nothing parseable', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, [{ nonsense: true }] as never)

    const manifest = await jupiter.discover(new AbortController().signal)

    expect(manifest).toEqual([])
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o produced no tokens from %o',
      'jupiter',
      VERIFIED_URL,
    )
  })

  it('reuses an already-registered terminal row instead of issuing a duplicate', async () => {
    // Both discover() and collect() prefer `terminal.get(id)` over a fresh
    // `terminal.issue(...)` — the get-or-issue idiom that avoids the "duplicated
    // row" throw across repeated collection cycles.
    const reusedRow = harness.utilsModule.terminalRow
    harness.utilsModule.terminal.get.mockReturnValueOnce(reusedRow)
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    fetchMock.mockResolvedValue(jsonResponse([]))

    await jupiter.discover(new AbortController().signal)

    expect(harness.utilsModule.terminal.issue).not.toHaveBeenCalled()
  })

  it('stores each prepared list token, falling back to a null uri for an empty logo, and tolerates a single token failure', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, [
      rawToken({ symbol: 'NOICON', icon: '' }),
      rawToken({ symbol: 'BOOM' }),
      ...rawTokens(3, ['verified']),
    ] as never)
    fetchMock.mockResolvedValue(jsonResponse([]))
    await jupiter.discover(new AbortController().signal)

    const originalFetchImageAndStoreForToken = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
    harness.dbModule.fetchImageAndStoreForToken.mockImplementation(async (input: { token: { symbol: string } }, tx) => {
      if (input.token.symbol === 'BOOM') throw new Error('storage exploded')
      return originalFetchImageAndStoreForToken(input, tx)
    })

    await jupiter.collect(new AbortController().signal)

    const noIconImage = harness.state.tokenImages.find((image) => image.token.symbol === 'NOICON')
    expect(noIconImage?.uri).toBeNull()
    expect(harness.state.tokenImages.some((image) => image.token.symbol === 'BOOM')).toBe(false)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'token %o/%o/%o failed: %o',
      'jupiter',
      'tag-verified',
      expect.any(String),
      'storage exploded',
    )
  })

  it('stops storing once the signal is already aborted before collect() starts', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    fetchMock.mockResolvedValue(jsonResponse([]))
    await jupiter.discover(new AbortController().signal)

    await jupiter.collect(
      (() => {
        const controller = new AbortController()
        controller.abort()
        return controller
      })().signal,
    )

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops mid-list once the signal aborts between tokens', async () => {
    // The insert concurrency is 8; with more tokens than that, some are still
    // queued (not yet started) when the abort lands, so they can actually
    // observe it — unlike a batch that all starts before anything resolves.
    const listSize = 12
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(listSize, ['verified']) as never)
    fetchMock.mockResolvedValue(jsonResponse([]))
    await jupiter.discover(new AbortController().signal)

    const controller = new AbortController()
    let calls = 0
    const originalFetchImageAndStoreForToken = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
    harness.dbModule.fetchImageAndStoreForToken.mockImplementation(async (input: unknown, tx: unknown) => {
      calls += 1
      // Abort synchronously, before the first `await`, so it lands while the
      // remaining concurrency-limited workers are still being kicked off —
      // waiting for this call to resolve first would let every worker's own
      // guard check already pass before any of them observed the abort.
      if (calls === 1) controller.abort()
      return originalFetchImageAndStoreForToken(input, tx)
    })

    await jupiter.collect(controller.signal)

    expect(harness.state.tokenImages.length).toBeLessThan(listSize)
  })

  it('exposes a standalone collect() that runs discover() then collect() in sequence', async () => {
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    fetchMock.mockResolvedValue(jsonResponse([]))

    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['jupiter'])
    expect(harness.state.tokenImages).toHaveLength(5)
  })
})
