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

import { RESPONSE_SHAPE_VERSION } from './response-cache'
import { COMPACT_FIELDS } from './compact'

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
    getLargestLists: vi.fn(),
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
    expect(tokensByChainCacheKey('eip155-1', 50_000)).toBe(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:eip155-1:50000:`)
  })

  it('keys only on chainId and limit — ?extensions= can no longer fork the cache', () => {
    expect(tokensByChainCacheKey('eip155-1', 100)).toBe(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:eip155-1:100:`)
  })

  it('gives the compact format its own key, so the two bodies never collide', () => {
    const compact = tokensByChainCacheKey('eip155-1', 50_000, 'compact')
    expect(compact).toBe(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain-compact:eip155-1:50000:`)
    expect(compact).not.toBe(tokensByChainCacheKey('eip155-1', 50_000))
    expect(tokensByChainCacheKey('eip155-1', 50_000, 'default')).toBe(tokensByChainCacheKey('eip155-1', 50_000))
  })

  it('keeps the full-row compact key when every field is selected, and forks it for a projection', () => {
    const full = tokensByChainCacheKey('eip155-1', 50_000, 'compact')
    expect(tokensByChainCacheKey('eip155-1', 50_000, 'compact', COMPACT_FIELDS)).toBe(full)
    const projected = tokensByChainCacheKey('eip155-1', 50_000, 'compact', ['address', 'symbol'])
    expect(projected).toBe(`${full}address,symbol`)
    expect(projected).not.toBe(full)
  })

  it('ignores fields for the default format', () => {
    expect(tokensByChainCacheKey('eip155-1', 50_000, 'default', ['address'])).toBe(
      tokensByChainCacheKey('eip155-1', 50_000),
    )
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

/**
 * The interface requests two compact variants per chain. Without warming, the first
 * request for each parses the whole default body (6 MB for Ethereum) before it answers.
 */
describe('warmTokensByChainCache compact variants', () => {
  const CHAIN = 'eip155-1'
  const INTERFACE_FIELDS = ['address', 'name', 'symbol', 'decimals', 'sources'] as const
  const SLICE_KEY = tokensByChainCacheKey(CHAIN, 60, 'compact', INTERFACE_FIELDS)
  const FULL_KEY = tokensByChainCacheKey(CHAIN, 50_000, 'compact', INTERFACE_FIELDS)
  const DEFAULT_KEY = tokensByChainCacheKey(CHAIN, 50_000)
  const WARM_STALE_MS = 6 * 60 * 60 * 1000

  const tokens = Array.from({ length: 100 }, (_, index) => ({
    address: `0x${index.toString(16).padStart(40, '0')}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    decimals: 18,
    logoURI: `https://gib.show/image/${index}`,
    sources: [`provider/list${index % 3}`],
  }))
  const defaultBodyJson = JSON.stringify({ chainId: 1, chainIdentifier: CHAIN, total: 100, tokens })

  const freshRow = (value: string) => ({ value, expiresAt: new Date(Date.now() + STALE_TTL_MS) })
  const staleRow = (value: string) => ({
    value,
    expiresAt: new Date(Date.now() + STALE_TTL_MS - WARM_STALE_MS - 1000),
  })

  /** Serve cache rows by key; any key absent from the map is a miss. */
  const serveRows = (rows: Record<string, ReturnType<typeof freshRow> | undefined>) =>
    vi.mocked(db.getCachedRequest).mockImplementation((async (key: string) => rows[key]) as never)

  const writtenRows = (): Record<string, string> =>
    Object.fromEntries(vi.mocked(db.insertCacheRequest).mock.calls.map(([{ key, value }]) => [key, value]))

  const defaultBodyParses = (parse: { mock: { calls: unknown[][] } }) =>
    parse.mock.calls.filter(([text]) => text === defaultBodyJson).length

  beforeEach(() => {
    resetDbMocks()
    vi.mocked(db.getCachedRequest).mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the first-screen slice and the full list under the keys the interface will read', async () => {
    serveRows({ [DEFAULT_KEY]: freshRow(defaultBodyJson) })
    const { warmTokensByChainCache } = await import('./handlers')

    await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)

    const written = writtenRows()
    expect(Object.keys(written).sort()).toEqual([FULL_KEY, SLICE_KEY].sort())
    const slice = JSON.parse(written[SLICE_KEY])
    const full = JSON.parse(written[FULL_KEY])
    expect(slice).toMatchObject({ format: 'compact', fields: INTERFACE_FIELDS, total: 100 })
    expect(slice.tokens).toHaveLength(60)
    expect(full.tokens).toHaveLength(100)
    expect(slice.tokens[0][0]).toBe(tokens[0].address)
    expect(slice.tokens[0][1]).toBe('Token 0')
    expect(full.sources).toEqual(['provider/list0', 'provider/list1', 'provider/list2'])
  })

  it('builds the variants from the default body it just built when that row was stale', async () => {
    serveRows({ [DEFAULT_KEY]: staleRow('{}') })
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([] as never)
    const { warmTokensByChainCache } = await import('./handlers')

    await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)

    // The stale row held `{}`; deriving from it would have thrown on `tokens.slice`.
    expect(Object.keys(writtenRows()).sort()).toEqual([DEFAULT_KEY, FULL_KEY, SLICE_KEY].sort())
    expect(JSON.parse(writtenRows()[FULL_KEY])).toMatchObject({ total: 0, tokens: [] })
  })

  it('parses the default body once per chain, not once per variant', async () => {
    serveRows({ [DEFAULT_KEY]: freshRow(defaultBodyJson) })
    const parse = vi.spyOn(JSON, 'parse')
    const { warmTokensByChainCache } = await import('./handlers')

    await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)

    expect(db.insertCacheRequest).toHaveBeenCalledTimes(2)
    expect(defaultBodyParses(parse)).toBe(1)
  })

  it('skips fresh variant rows and does not parse the default body for them', async () => {
    serveRows({
      [DEFAULT_KEY]: freshRow(defaultBodyJson),
      [SLICE_KEY]: freshRow('slice'),
      [FULL_KEY]: freshRow('full'),
    })
    const parse = vi.spyOn(JSON, 'parse')
    const { warmTokensByChainCache } = await import('./handlers')

    await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)

    expect(db.insertCacheRequest).not.toHaveBeenCalled()
    expect(defaultBodyParses(parse)).toBe(0)
  })

  it('rebuilds a stale variant row and leaves the fresh one alone', async () => {
    serveRows({
      [DEFAULT_KEY]: freshRow(defaultBodyJson),
      [SLICE_KEY]: staleRow('old slice'),
      [FULL_KEY]: freshRow('full'),
    })
    const { warmTokensByChainCache } = await import('./handlers')

    await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)

    expect(Object.keys(writtenRows())).toEqual([SLICE_KEY])
    expect(JSON.parse(writtenRows()[SLICE_KEY]).tokens).toHaveLength(60)
  })

  it('keeps warming the other variant and the next chain when one variant fails', async () => {
    const otherDefaultKey = tokensByChainCacheKey('eip155-369', 50_000)
    const otherSliceKey = tokensByChainCacheKey('eip155-369', 60, 'compact', INTERFACE_FIELDS)
    vi.mocked(db.getCachedRequest).mockImplementation((async (key: string) => {
      if (key === SLICE_KEY) throw new Error('cache read failed')
      if (key === DEFAULT_KEY || key === otherDefaultKey) return freshRow(defaultBodyJson)
      return undefined
    }) as never)
    const { warmTokensByChainCache } = await import('./handlers')

    await expect(
      warmTokensByChainCache(
        [
          { chainId: CHAIN, count: 100 },
          { chainId: 'eip155-369', count: 50 },
        ],
        2,
      ),
    ).resolves.toBeUndefined()

    const keys = Object.keys(writtenRows())
    expect(keys).toContain(FULL_KEY)
    expect(keys).not.toContain(SLICE_KEY)
    expect(keys).toContain(otherSliceKey)
  })

  describe('the request handler', () => {
    const invoke = async (query: Record<string, string>) => {
      const { tokensByChain } = await import('./handlers')
      let sent: string | undefined
      const res = {
        set: () => {},
        send: (body: string) => void (sent = body),
      }
      const next = vi.fn()
      await tokensByChain({ params: { chainId: CHAIN }, query, headers: {} } as never, res as never, next)
      expect(next).not.toHaveBeenCalled()
      return sent
    }
    const sliceQuery = { limit: '60', format: 'compact', fields: 'address,name,symbol,decimals,sources' }
    const fullQuery = { format: 'compact', fields: 'address,name,symbol,decimals,sources' }

    it('reads the exact keys the warmer wrote, for both variants', async () => {
      serveRows({ [DEFAULT_KEY]: freshRow(defaultBodyJson) })
      const { warmTokensByChainCache } = await import('./handlers')
      await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)
      const written = writtenRows()

      vi.mocked(db.getCachedRequest)
        .mockReset()
        .mockResolvedValue(freshRow('x') as never)
      await invoke(sliceQuery)
      await invoke(fullQuery)

      const readKeys = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
      expect(readKeys).toEqual([SLICE_KEY, FULL_KEY])
      expect(Object.keys(written).sort()).toEqual([...readKeys].sort())
    })

    it('answers from the warmed row without touching the default body or the database', async () => {
      serveRows({ [DEFAULT_KEY]: freshRow(defaultBodyJson) })
      const { warmTokensByChainCache } = await import('./handlers')
      await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)
      const written = writtenRows()
      serveRows({ [SLICE_KEY]: freshRow(written[SLICE_KEY]), [FULL_KEY]: freshRow(written[FULL_KEY]) })
      vi.mocked(db.insertCacheRequest).mockClear()
      vi.mocked(db.getCachedRequest).mockClear()
      const parse = vi.spyOn(JSON, 'parse')

      expect(await invoke(sliceQuery)).toBe(written[SLICE_KEY])
      expect(await invoke(fullQuery)).toBe(written[FULL_KEY])

      expect(vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)).not.toContain(DEFAULT_KEY)
      expect(defaultBodyParses(parse)).toBe(0)
      expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
      expect(db.insertCacheRequest).not.toHaveBeenCalled()
    })

    it('derives the same bytes the warmer wrote, so a warmed row is the row a cold request would build', async () => {
      serveRows({ [DEFAULT_KEY]: freshRow(defaultBodyJson) })
      const { warmTokensByChainCache } = await import('./handlers')
      await warmTokensByChainCache([{ chainId: CHAIN, count: 100 }], 1)
      const written = writtenRows()

      serveRows({ [DEFAULT_KEY]: freshRow(defaultBodyJson) })

      expect(await invoke(sliceQuery)).toBe(written[SLICE_KEY])
      expect(await invoke(fullQuery)).toBe(written[FULL_KEY])
    })
  })
})

/**
 * The merged endpoint is the heavier of the two chain-scoped ones and was the only
 * one left unwarmed, so a real user could still land on its multi-second cold build
 * — most reliably right after a deploy, since startup clears the whole cache.
 */
describe('warmMergedCache', () => {
  // resetDbMocks leaves the two cache accessors alone, and these tests assert on
  // which key reached them — so calls from earlier describes would be read as this
  // warmer's own. Reset both here rather than widening the shared helper, which the
  // describes above depend on as it stands.
  beforeEach(() => {
    resetDbMocks()
    vi.mocked(db.getCachedRequest).mockReset()
    vi.mocked(db.insertCacheRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
  })

  it('writes rows under the exact key an unqualified merged request produces', async () => {
    // The warmer and the request handler must agree byte-for-byte on the key. If they
    // drift, the warmer still reports success while every request continues to miss —
    // a silent failure that looks exactly like a warmer that is working.
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([] as never)

    const { warmMergedCache, mergedCacheKey } = await import('./handlers')
    await warmMergedCache([{ chainId: 'eip155-1', count: 5000 }], 1)

    const expectedKey = mergedCacheKey({
      orderId: '0xdefaultorder',
      chainId: 'eip155-1',
      extensions: new Set<string>(),
      decimals: undefined,
    })
    expect(vi.mocked(db.getCachedRequest).mock.calls[0][0]).toBe(expectedKey)
    expect(vi.mocked(db.insertCacheRequest).mock.calls[0][0]).toMatchObject({ key: expectedKey })
  })

  it('rebuilds only the top N chains by token count', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([] as never)

    const { warmMergedCache } = await import('./handlers')
    await warmMergedCache(
      [
        { chainId: 'eip155-1', count: 5000 },
        { chainId: 'eip155-369', count: 4000 },
        { chainId: 'eip155-56', count: 3000 },
      ],
      2,
    )

    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
    expect(db.getTokensByChainRanked).toHaveBeenCalledWith('eip155-1', '0xdefaultorder', {
      bridgeInfo: false,
      headerUri: false,
    })
  })

  it('skips a chain whose cache row is still younger than the warm-stale threshold', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)

    const { warmMergedCache } = await import('./handlers')
    await warmMergedCache([{ chainId: 'eip155-1', count: 5000 }], 5)

    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
  })

  it('is best-effort — a chain that fails to build must not stop the rest from warming', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getTokensByChainRanked)
      .mockRejectedValueOnce(new Error('query timeout'))
      .mockResolvedValueOnce([] as never)

    const { warmMergedCache } = await import('./handlers')
    await expect(
      warmMergedCache(
        [
          { chainId: 'eip155-1', count: 5000 },
          { chainId: 'eip155-369', count: 4000 },
        ],
        5,
      ),
    ).resolves.toBeUndefined()

    expect(db.getTokensByChainRanked).toHaveBeenCalledTimes(2)
  })

  it('does nothing when no default order has been synced yet', async () => {
    // Startup order matters: the warmer runs after syncDefaultOrder, but if that has
    // not produced an id there is no ranking to build against, and warming under a
    // placeholder key would poison the cache with bodies ranked by nothing.
    vi.mocked(getDefaultListOrderId).mockReturnValueOnce(undefined as never)

    const { warmMergedCache } = await import('./handlers')
    await warmMergedCache([{ chainId: 'eip155-1', count: 5000 }], 5)

    expect(db.getCachedRequest).not.toHaveBeenCalled()
    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
  })
})

describe('warmProviderListCache', () => {
  // Same reasoning as warmMergedCache above: these assert on which key reached the cache
  // accessors, so calls left over from earlier describes would be read as this warmer's.
  beforeEach(() => {
    resetDbMocks()
    vi.mocked(db.getCachedRequest).mockReset()
    vi.mocked(db.insertCacheRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.getLargestLists).mockReset()
    vi.mocked(db.getLists).mockReset()
    // buildListPayload reaches for the token query builder, which is chainable rather
    // than a plain promise. The warmer runs the handler's own build verbatim — that is
    // the point of it — so the stub has to satisfy the real code path.
    vi.mocked(db.getTokensUnderListId).mockReturnValue({
      where: () => ({ orderBy: async () => [] }),
    } as never)
  })

  const aList = {
    listId: 'list-1',
    name: 'Coingecko Ethereum',
    imageHash: null,
    ext: null,
    mode: null,
    uri: null,
    updatedAt: '2026-07-25T00:00:00.000Z',
    major: 1,
    minor: 0,
    patch: 0,
    providerKey: 'coingecko',
    key: 'ethereum',
  }

  it('writes rows under the exact key a bare provider-list request produces', async () => {
    // Provider lists were the one cached endpoint nobody warmed, so this warmer is new
    // and its key has never been proven to agree with the handler's. If it drifts the
    // warmer still reports success while every request misses — a silent failure that
    // looks identical to a warmer that works.
    vi.mocked(db.getLargestLists).mockResolvedValue([{ providerKey: 'coingecko', listKey: 'ethereum' }] as never)
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getLists).mockResolvedValue([aList] as never)

    const { warmProviderListCache, listCacheKey } = await import('./handlers')
    await warmProviderListCache(1)

    const expectedKey = listCacheKey({
      providerKey: 'coingecko',
      listKey: 'ethereum',
      extensions: new Set<string>(),
      chainId: undefined,
      decimals: undefined,
    })
    expect(vi.mocked(db.getCachedRequest).mock.calls[0][0]).toBe(expectedKey)
    expect(vi.mocked(db.insertCacheRequest).mock.calls[0][0]).toMatchObject({ key: expectedKey })
  })

  it('skips a list whose cached row is still inside the freshness window', async () => {
    // The periodic tick runs on the same interval as the freshness window, so without
    // this every tick would rebuild all twenty lists whether or not anything changed.
    vi.mocked(db.getLargestLists).mockResolvedValue([{ providerKey: 'coingecko', listKey: 'ethereum' }] as never)
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      key: 'k',
      value: '{}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS - 60_000),
    } as never)

    const { warmProviderListCache } = await import('./handlers')
    await warmProviderListCache(1)

    expect(db.getLists).not.toHaveBeenCalled()
    expect(db.insertCacheRequest).not.toHaveBeenCalled()
  })

  it('keeps going when one list cannot be built', async () => {
    // Runs inside startup and inside the periodic tick. A provider whose list has been
    // deleted since the ranking query picked it must not stop the lists behind it, and
    // must not take down the boot.
    vi.mocked(db.getLargestLists).mockResolvedValue([
      { providerKey: 'gone', listKey: 'missing' },
      { providerKey: 'coingecko', listKey: 'ethereum' },
    ] as never)
    vi.mocked(db.getCachedRequest).mockResolvedValue(undefined as never)
    vi.mocked(db.getLists)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([aList] as never)

    const { warmProviderListCache } = await import('./handlers')
    await expect(warmProviderListCache(2)).resolves.toBeUndefined()

    expect(db.getLists).toHaveBeenCalledTimes(2)
    expect(vi.mocked(db.insertCacheRequest).mock.calls).toHaveLength(1)
  })

  it('does nothing when the ranking query itself fails', async () => {
    // No list of lists means nothing to warm. Throwing here would abort the startup
    // chain before the content delivery network purge that follows it.
    vi.mocked(db.getLargestLists).mockRejectedValue(new Error('database down'))

    const { warmProviderListCache } = await import('./handlers')
    await expect(warmProviderListCache()).resolves.toBeUndefined()

    expect(db.getCachedRequest).not.toHaveBeenCalled()
  })
})
