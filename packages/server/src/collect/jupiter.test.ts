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

/**
 * Membership over time. Each `runOnce` is one full collect cycle against the harness's
 * in-memory model of the `list` and `list_token` tables, so these tests read what a reader
 * would be served after the run rather than what the collector asked the database to do.
 */
describe('jupiter list membership across runs', () => {
  type Feeds = { verified?: unknown[]; recent?: unknown[] | Error }
  type Raw = { id: string }

  const listsFor = (listKey: string) => harness.state.lists.filter((list) => list.key === listKey)

  /** One collect cycle. Category feeds other than `recent` answer empty (unreliable, left alone). */
  const runOnce = async ({ verified = rawTokens(5, ['verified']), recent = [] }: Feeds) => {
    harness.queueTokenListResponse(VERIFIED_URL, verified as never)
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== RECENT_URL) return jsonResponse([])
      if (recent instanceof Error) throw recent
      return jsonResponse(recent)
    })
    await collect(new AbortController().signal)
  }

  /** The members a reader is served for a list key: the newest published version's token ids. */
  const servedMembers = async (listKey: string): Promise<string[]> => {
    const { providerId } = harness.state.providers[0]
    const { published } = await harness.dbModule.getListVersionSnapshot({ providerId, listKey })
    return published ? [...published.providedIds].sort() : []
  }

  const versionOf = (list: { major: number; minor: number; patch: number }) =>
    `${list.major}.${list.minor}.${list.patch}`

  const tokensOf = (count: number) => Array.from({ length: count }, () => rawToken({ tags: ['verified'] }))

  it('drops a token that left the feed: present in run 1, absent from the served list after run 2', async () => {
    const [leaving, staying, ...rest] = tokensOf(7)
    const arriving = rawToken({ tags: ['verified'] })
    await runOnce({ recent: [leaving, staying, ...rest] })
    expect(await servedMembers('recent')).toContain(leaving.id)

    await runOnce({ recent: [staying, ...rest, arriving] })

    const served = await servedMembers('recent')
    expect(served).not.toContain(leaving.id)
    expect(served).toContain(arriving.id)
    expect(served).toHaveLength(7)
  })

  it('keeps the dropped token filed under the superseded version, so its icon is still found', async () => {
    const [leaving, ...rest] = tokensOf(6)
    await runOnce({ recent: [leaving, ...rest] })
    await runOnce({ recent: [...rest, rawToken({ tags: ['verified'] })] })

    const [oldVersion, newVersion] = listsFor('recent').sort((a, b) => a.patch - b.patch)
    expect(versionOf(oldVersion)).toBe('0.0.0')
    expect(versionOf(newVersion)).toBe('0.0.1')
    const oldRow = harness.state.tokenImages.find(
      (image) => image.listId === oldVersion.listId && image.token.providedId === leaving.id,
    )
    expect(oldRow?.uri).toBe('https://example.com/icon.png')
  })

  it('files no new version when the feed returns the same members, even in a different order', async () => {
    const feed = tokensOf(6)
    const verified = tokensOf(6)
    await runOnce({ verified, recent: feed })
    await runOnce({ verified, recent: [...feed].reverse() })
    await runOnce({ verified, recent: feed })

    expect(listsFor('recent')).toHaveLength(1)
    expect(listsFor('tag-verified')).toHaveLength(1)
  })

  it('files a new version of a tag list when that tag membership changed', async () => {
    const verified = tokensOf(6)
    await runOnce({ verified })
    await runOnce({ verified: [...verified.slice(1), rawToken({ tags: ['verified'] })] })

    expect(listsFor('tag-verified').map(versionOf).sort()).toEqual(['0.0.0', '0.0.1'])
  })

  it('numbers the next version above an unpublished one left by an interrupted run', async () => {
    const feed = tokensOf(6)
    await runOnce({ recent: feed })
    // An interrupted run left 0.0.1 filed but never published.
    const { providerId } = harness.state.providers[0]
    await harness.dbModule.insertList({ providerId, key: 'recent', name: 'x', major: 0, minor: 0, patch: 1 })

    await runOnce({ recent: [...feed.slice(1), rawToken({ tags: ['verified'] })] })

    expect(listsFor('recent').map(versionOf).sort()).toEqual(['0.0.0', '0.0.1', '0.0.2'])
    expect(await servedMembers('recent')).toHaveLength(6)
  })

  it('retires a tag list that no longer reaches the minimum size, and does so once', async () => {
    const yieldTokens = Array.from({ length: 6 }, () => rawToken({ tags: ['verified', 'yield'] }))
    await runOnce({ verified: yieldTokens })
    expect(await servedMembers('tag-yield')).toHaveLength(6)

    // Jupiter retired the tag: no verified token carries it any more.
    await runOnce({ verified: tokensOf(6) })
    expect(await servedMembers('tag-yield')).toEqual([])
    expect(listsFor('tag-yield').map(versionOf).sort()).toEqual(['0.0.0', '0.0.1'])

    await runOnce({ verified: tokensOf(6) })
    expect(listsFor('tag-yield')).toHaveLength(2)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o list=%o retired: no longer produced by the feed',
      'jupiter',
      'tag-yield',
    )
  })

  it('retires a category list whose feed answers with fewer tokens than the minimum', async () => {
    await runOnce({ recent: tokensOf(6) })
    await runOnce({ recent: tokensOf(2) })

    expect(await servedMembers('recent')).toEqual([])
  })

  it('leaves a category list alone when its feed fails or answers empty', async () => {
    await runOnce({ recent: tokensOf(6) })

    await runOnce({ recent: new Error('feed unreachable') })
    await runOnce({ recent: [] })

    expect(await servedMembers('recent')).toHaveLength(6)
    expect(listsFor('recent')).toHaveLength(1)
  })

  it('retires nothing when the run was aborted before it saw every feed', async () => {
    const yieldTokens = Array.from({ length: 6 }, () => rawToken({ tags: ['verified', 'yield'] }))
    await runOnce({ verified: yieldTokens })

    harness.queueTokenListResponse(VERIFIED_URL, tokensOf(6) as never)
    const controller = new AbortController()
    fetchMock.mockImplementation(async () => {
      controller.abort()
      return jsonResponse([])
    })
    await jupiter.discover(controller.signal)

    expect(await servedMembers('tag-yield')).toHaveLength(6)
  })

  it('does not publish a version in which no token could be stored, so the old one keeps serving', async () => {
    const feed = tokensOf(6) as Raw[]
    await runOnce({ recent: feed })
    const original = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
    harness.dbModule.fetchImageAndStoreForToken.mockRejectedValue(new Error('storage down'))
    try {
      await runOnce({ recent: [...feed.slice(1), rawToken({ tags: ['verified'] })] })
    } finally {
      harness.dbModule.fetchImageAndStoreForToken.mockImplementation(original)
    }

    expect(await servedMembers('recent')).toContain(feed[0].id)
  })

  it('trims old versions after a normal run, and not after an abort', async () => {
    await runOnce({ recent: tokensOf(6) })
    expect(harness.dbModule.pruneSupersededListVersions).toHaveBeenCalledWith({
      providerId: harness.state.providers[0].providerId,
      listKey: 'recent',
      keep: 3,
    })

    harness.dbModule.pruneSupersededListVersions.mockClear()
    harness.queueTokenListResponse(VERIFIED_URL, rawTokens(5, ['verified']) as never)
    fetchMock.mockImplementation(async () => jsonResponse(tokensOf(6)))
    await jupiter.discover(new AbortController().signal)
    const controller = new AbortController()
    controller.abort()
    await jupiter.collect(controller.signal)

    expect(harness.dbModule.pruneSupersededListVersions).not.toHaveBeenCalled()
  })

  it('logs and carries on when trimming old versions fails', async () => {
    harness.dbModule.pruneSupersededListVersions.mockRejectedValueOnce(new Error('lock timeout'))

    await runOnce({ recent: tokensOf(6) })

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o list=%o prune failed: %o',
      'jupiter',
      expect.any(String),
      'lock timeout',
    )
    expect(await servedMembers('recent')).toHaveLength(6)
  })
})
