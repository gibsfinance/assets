/**
 * Boundary-validation tests for the token list handlers.
 *
 * Why these matter: every case here reproduced as a production failure —
 * bare numeric chain ids silently returned empty lists, the unfiltered merged
 * query timed out into a 500, junk filter values surfaced as Postgres errors,
 * and invalid chain ids answered 200 with zero tokens. The handlers must fail
 * fast at the boundary with 400s, and bare/prefixed chain ids must be
 * interchangeable everywhere the spec promises they are.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { RESPONSE_SHAPE_VERSION } from './response-cache'

vi.mock('../../db', async () => {
  // Real normalizeProvidedId (isAddress ? lower : preserve) — the merged handler
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
    // Namespace resolution for bare numeric chain ids. Defaults to "nothing stored",
    // under which a bare number falls back to eip155 — the behaviour these tests
    // already assert. Cases that need a non-EVM chain override it per test.
    getChainIdsByReference: vi.fn(async () => []),
    searchTokens: vi.fn(async () => []),
    normalizeProvidedId,
  }
})
// A known admin token so the refresh-parameter gate has something to accept and
// something to reject; everything else in config keeps its real value.
vi.mock('../../../config', async () => {
  const actual = await vi.importActual<{ default: Record<string, unknown> }>('../../../config')
  return { default: { ...actual.default, adminToken: 'test-admin-token' } }
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
// getFilteredLists (behind `all`) is the only code in this file that inspects
// drizzle-orm's output directly (the merged/tokensByChain whereClauses pass
// straight into the already-mocked db.applyOrder without being examined) —
// safe to mock file-wide with marker objects, so the query-builder assertions
// below can tell eq from inArray from or apart.
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ op: 'and', conds })),
  or: vi.fn((...conds: unknown[]) => ({ op: 'or', conds })),
  inArray: vi.fn((col: unknown, vals: unknown[]) => ({ op: 'inArray', col, vals })),
  asc: vi.fn((col: unknown) => ({ op: 'asc', col })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', strings: [...strings], values })),
    { join: vi.fn(), raw: vi.fn() },
  ),
}))
// buildListPayload (behind versioned/providerKeyed) is exercised end-to-end,
// with real drizzle chain internals, in utils.test.ts — mocked here so this
// file only asserts what versioned/providerKeyed themselves build (the merged
// list object and the 404 branches), not the payload builder's own logic.
vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils')
  return { ...actual, buildListPayload: vi.fn(async () => ({ ok: true })) }
})

import * as db from '../../db'
import * as listUtils from './utils'
import { getDrizzle } from '../../db/drizzle'
import { bumpSubscriberCount } from '../../collect/user-submissions'
import { merged, tokensByChain, all, versioned, providerKeyed, search } from './handlers'
import { SEARCH_CANDIDATE_CAP } from '../../db/search'
import { getDefaultListOrderId } from '../../db/sync-order'

/** Chainable drizzle query-builder mock matching getFilteredLists' call shape. */
function makeQueryChain() {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'leftJoin', 'where', '$dynamic']) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  return chain
}

const STALE_TTL_MS = 24 * 60 * 60 * 1000

const mockResponse = () => ({
  set: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
})

const callMerged = async (query: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = mockResponse()
  const next = vi.fn()
  await merged({ params: { order: 'default' }, query, headers } as never, res as never, next as never)
  return { res, next }
}

/**
 * The merged body as an object. It goes out through `res.send` as a pre-serialized
 * string, because that is the form the cache stores — a cached response and a freshly
 * built one must be the same bytes, and `res.json` would re-serialize only one of them.
 */
const mergedBody = (res: ReturnType<typeof mockResponse>) => JSON.parse(res.send.mock.calls[0][0] as string)

describe('merged handler', () => {
  beforeEach(() => {
    // Cache miss by default, so these tests exercise the build path. The write is
    // fire-and-forget, so it has to resolve or the handler rejects on `.catch`.
    vi.mocked(db.getCachedRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.insertCacheRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.getListOrderId)
      .mockReset()
      .mockResolvedValue('order-1' as never)
    vi.mocked(db.applyOrder).mockReset()
    vi.mocked(db.getTokensByChainRanked)
      .mockReset()
      .mockResolvedValue([
        {
          chainId: 'eip155-369',
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
        },
      ] as never)
  })

  it('rejects a missing chainId with 400 — the unfiltered ordering query times out in production', async () => {
    const { res, next } = await callMerged({})
    expect(next).toHaveBeenCalledTimes(1)
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toBe('chainId query parameter is required')
    // Fail before any database work happens.
    expect(db.getListOrderId).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it('returns identical tokens for bare and prefixed chainId values', async () => {
    // Regression: rows carry prefixed ids (eip155-369); the post-query filter
    // compared the raw query value, so ?chainId=369 returned zero tokens while
    // ?chainId=eip155-369 returned the full list.
    const bare = await callMerged({ chainId: '369' })
    const prefixed = await callMerged({ chainId: 'eip155-369' })

    expect(bare.next).not.toHaveBeenCalled()
    expect(prefixed.next).not.toHaveBeenCalled()
    const bareBody = mergedBody(bare.res)
    const prefixedBody = mergedBody(prefixed.res)
    expect(bareBody.tokens).toHaveLength(1)
    expect(bareBody.tokens).toEqual(prefixedBody.tokens)
  })

  it('reads through the ranked query rather than the dense_rank window', async () => {
    // Production regression: this handler ran applyOrder's dense_rank window, which
    // materializes every list_token row for the chain and sorts them globally. That is
    // the same query tokensByChain moved off for being too slow on large chains, and
    // here it meant /list/merged answered 500 at the sixty-second ceiling for Ethereum,
    // Binance Smart Chain and everything else of that size — only PulseChain returned.
    // Asserting the call target, not a timing, is what keeps this from regressing:
    // whichever query is wired up is the whole difference between 200 and 500.
    vi.mocked(db.getTokensByChainRanked).mockResolvedValue([
      {
        chainId: 'eip155-1',
        providedId: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        decimals: 8,
        symbol: 'WBTC',
        name: 'Wrapped Bitcoin',
        imageHash: 'hash2',
        ext: '.png',
        mode: 'save',
        uri: null,
        providerKey: 'trustwallet',
        listKey: 'wallet-ethereum',
      },
    ] as never)
    const { res, next } = await callMerged({ chainId: 'eip155-1' })

    expect(next).not.toHaveBeenCalled()
    expect(db.getTokensByChainRanked).toHaveBeenCalledWith('eip155-1', 'order-1', {
      bridgeInfo: false,
      headerUri: false,
    })
    expect(db.applyOrder).not.toHaveBeenCalled()
    expect(mergedBody(res).tokens).toHaveLength(1)
  })

  it('answers an empty list for the asset-0 sentinel without querying for it', async () => {
    // asset-0 is internal bookkeeping, not a chain — /networks and /stats both strip it.
    // The where clause the ranked query replaced excluded it explicitly, so an empty
    // list is the behaviour being preserved; without the guard the sentinel's own rows
    // would be served to a caller who asked for a chain.
    const { res, next } = await callMerged({ chainId: 'asset-0' })

    expect(next).not.toHaveBeenCalled()
    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
    expect(mergedBody(res).tokens).toEqual([])
  })

  it('rejects with 404 when the requested order id has no matching list order', async () => {
    vi.mocked(db.getListOrderId).mockResolvedValue(null as never)
    const { res, next } = await callMerged({ chainId: '369' })

    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(404)
    expect(error.message).toBe('order id missing')
    expect(res.json).not.toHaveBeenCalled()
  })

  it('rejects a bare chainId that several populated namespaces claim', async () => {
    vi.mocked(db.getChainIdsByReference).mockResolvedValueOnce([
      { chainId: 'solana-42', hasTokens: true },
      { chainId: 'tvm-42', hasTokens: true },
    ] as never)

    const { res, next } = await callMerged({ chainId: '42' })

    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toContain('solana-42')
    expect(error.message).toContain('tvm-42')
    expect(res.json).not.toHaveBeenCalled()
  })

  it('serves a cached body without rebuilding it', async () => {
    // The reason this endpoint is cached at all: the query behind it takes sixteen to
    // twenty-two seconds on a large chain, against roughly one for the same query read
    // from cache. If a cache hit still ran the query the endpoint would be no faster,
    // only more complicated.
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":[{"address":"0xcached"}]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)

    const { res, next } = await callMerged({ chainId: '369' })

    expect(next).not.toHaveBeenCalled()
    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
    expect(mergedBody(res).tokens).toEqual([{ address: '0xcached' }])
  })

  it('keys the cache on the chain, so one chain never answers with another chain body', async () => {
    await callMerged({ chainId: '369' })
    await callMerged({ chainId: 'eip155-1' })

    const [first, second] = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    expect(first).not.toBe(second)
    expect(first).toContain('eip155-369')
    expect(second).toContain('eip155-1')
  })

  it('resolves the chain before keying, so bare and prefixed ids share one cached body', async () => {
    // Otherwise ?chainId=369 and ?chainId=eip155-369 each keep their own copy of a
    // twelve-megabyte body — identical bytes, twice the storage, and two rebuilds.
    await callMerged({ chainId: '369' })
    await callMerged({ chainId: 'eip155-369' })

    const [bare, prefixed] = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    expect(bare).toBe(prefixed)
  })

  it('keys the cache on extensions, and orders them so one request cannot fork into two', async () => {
    await callMerged({ chainId: '369', extensions: 'bridgeInfo,headerUri' })
    await callMerged({ chainId: '369', extensions: 'headerUri,bridgeInfo' })
    await callMerged({ chainId: '369' })

    const [forward, reversed, none] = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    // The same two extensions in either order are one response, not two.
    expect(forward).toBe(reversed)
    // But requesting them is not the same response as not requesting them: the
    // extension columns are joined into the query, so the bodies genuinely differ.
    expect(none).not.toBe(forward)
  })

  it('rejects an unauthorized refresh rather than quietly serving the cache', async () => {
    // This is the more expensive of the two chain-scoped endpoints. An open refresh
    // parameter would let anyone force the full ranked query on every request.
    const { res, next } = await callMerged({ chainId: '369', refresh: '1' })

    const error = next.mock.calls[0][0] as { status: number }
    expect(error.status).toBe(401)
    expect(db.getTokensByChainRanked).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('rebuilds and rewrites the cache for an authorized refresh', async () => {
    // A refresh that only served its own caller would leave the next ordinary visitor
    // on the stale body, which defeats the point of having the parameter.
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":[{"address":"0xstale"}]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)

    const { res, next } = await callMerged(
      { chainId: '369', refresh: '1' },
      { authorization: 'Bearer test-admin-token' },
    )

    expect(next).not.toHaveBeenCalled()
    expect(db.getTokensByChainRanked).toHaveBeenCalled()
    expect(mergedBody(res).tokens).toHaveLength(1)
    expect(mergedBody(res).tokens[0].address).not.toBe('0xstale')
    expect(db.insertCacheRequest).toHaveBeenCalled()
    // And the rebuilt body must not itself be cached at the edge, or the refresh URL
    // becomes a cache entry that hands the same body to everyone else.
    expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
  })
})

describe('tokensByChain handler', () => {
  beforeEach(() => {
    vi.mocked(db.getCachedRequest)
      .mockReset()
      .mockResolvedValue({ value: '{"tokens":[]}', expiresAt: new Date(Date.now() + STALE_TTL_MS) } as never)
  })

  const callTokensByChain = async (
    chainId: string,
    query: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    const res = mockResponse()
    const next = vi.fn()
    // Headers are always present on a real express request; the handler reads
    // Authorization for the admin-gated refresh parameter.
    await tokensByChain({ params: { chainId }, query, headers } as never, res as never, next as never)
    return { res, next }
  }

  it('rejects a syntactically invalid chainId with 400 instead of an empty 200', async () => {
    // Regression: /list/tokens/banana answered 200 with chainId null and
    // total 0 — the documented 400 never fired.
    const { res, next } = await callTokensByChain('banana')
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toContain('banana')
    expect(db.getCachedRequest).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('rejects an empty chainId before any validation runs', async () => {
    const { res, next } = await callTokensByChain('')
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toBe('chainId required')
    expect(db.getCachedRequest).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('rejects a prefixed id with a non-numeric reference', async () => {
    const { next } = await callTokensByChain('eip155-banana')
    expect((next.mock.calls[0][0] as { status: number }).status).toBe(400)
  })

  it('serves bare numeric and asset-0 chain ids', async () => {
    const bare = await callTokensByChain('369')
    expect(bare.next).not.toHaveBeenCalled()
    expect(bare.res.send).toHaveBeenCalled()

    const asset = await callTokensByChain('asset-0')
    expect(asset.next).not.toHaveBeenCalled()
  })

  it('falls back to the default limit for negative values — junk limits must not fork cache keys', async () => {
    await callTokensByChain('369', { limit: '-5' })
    expect(db.getCachedRequest).toHaveBeenCalledWith(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:eip155-369:50000:`)
  })

  it('clamps oversized limits to the documented maximum', async () => {
    await callTokensByChain('369', { limit: '999999' })
    expect(db.getCachedRequest).toHaveBeenCalledWith(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:eip155-369:100000:`)
  })

  // End-to-end proof of the namespace fix, at the layer that broke. /stats reports
  // {chainId: "501", chainIdentifier: "solana-501"}, and feeding that bare 501 back
  // in used to read the eip155-501 cache key, which nothing ever writes — 200 with
  // zero tokens against /stats reporting 6286.
  it('reads a bare non-evm chain id from its own namespace, not eip155', async () => {
    vi.mocked(db.getChainIdsByReference).mockResolvedValueOnce([{ chainId: 'solana-501', hasTokens: true }] as never)
    await callTokensByChain('501')
    expect(db.getCachedRequest).toHaveBeenCalledWith(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:solana-501:50000:`)
  })

  // A phantom eip155 row must not shadow the namespace holding the tokens — the dev
  // database has exactly this pair, and migration 0008 deletes four more like it.
  it('ignores an empty eip155 row when another namespace holds the tokens', async () => {
    vi.mocked(db.getChainIdsByReference).mockResolvedValueOnce([
      { chainId: 'eip155-501', hasTokens: false },
      { chainId: 'solana-501', hasTokens: true },
    ] as never)
    await callTokensByChain('501')
    expect(db.getCachedRequest).toHaveBeenCalledWith(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:solana-501:50000:`)
  })

  it('rejects a bare id that several populated namespaces claim', async () => {
    vi.mocked(db.getChainIdsByReference).mockResolvedValueOnce([
      { chainId: 'solana-42', hasTokens: true },
      { chainId: 'tvm-42', hasTokens: true },
    ] as never)
    const { next } = await callTokensByChain('42')
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toContain('solana-42')
    expect(error.message).toContain('tvm-42')
  })

  // An explicit namespace costs no lookup — it is already unambiguous.
  it('does not query candidates for an explicitly namespaced id', async () => {
    vi.mocked(db.getChainIdsByReference).mockClear()
    await callTokensByChain('solana-501')
    expect(db.getChainIdsByReference).not.toHaveBeenCalled()
    expect(db.getCachedRequest).toHaveBeenCalledWith(`${RESPONSE_SHAPE_VERSION}:tokens-by-chain:solana-501:50000:`)
  })

  describe('admin refresh parameter', () => {
    beforeEach(() => {
      // The refresh path builds instead of reading the cache, so the build's
      // queries need to answer with something rather than undefined.
      vi.mocked(db.getTokensByChainRanked)
        .mockReset()
        .mockResolvedValue([] as never)
      vi.mocked(db.getTokenSourcesByChain)
        .mockReset()
        .mockResolvedValue([] as never)
      vi.mocked(db.insertCacheRequest)
        .mockReset()
        .mockResolvedValue(undefined as never)
    })

    it('rejects refresh without a valid admin token instead of serving the cached body', async () => {
      // Silently downgrading to the cached read would tell an operator their deploy
      // is live when they are looking at a body built hours before it.
      const { res, next } = await callTokensByChain('eip155-369', { refresh: '1' })
      const error = next.mock.calls[0][0] as { status: number; message: string }
      expect(error.status).toBe(401)
      expect(error.message).toBe('unauthorized')
      expect(db.getCachedRequest).not.toHaveBeenCalled()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('bypasses the cache read and rebuilds when an admin asks for a refresh', async () => {
      await callTokensByChain('eip155-369', { refresh: '1' }, { authorization: 'Bearer test-admin-token' })
      // The whole point: the persisted row is skipped and the response is rebuilt.
      expect(db.getCachedRequest).not.toHaveBeenCalled()
      expect(db.getTokensByChainRanked).toHaveBeenCalled()
      // ...and the rebuilt body is written back, so the next ordinary visitor is
      // served the fresh value too rather than the row the refresh just bypassed.
      expect(db.insertCacheRequest).toHaveBeenCalled()
    })

    it('marks a refresh response no-store so no content delivery network keeps it', async () => {
      // A cacheable refresh response would be stored at the edge and handed to
      // everyone else, which reintroduces exactly the staleness it was clearing.
      const { res } = await callTokensByChain(
        'eip155-369',
        { refresh: '1' },
        { authorization: 'Bearer test-admin-token' },
      )
      expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
    })

    it('leaves an ordinary request on the cached path with its public cache-control', async () => {
      // Regression guard: the refresh wiring must be inert for traffic that did not
      // ask for it — every unauthenticated request still reads the cache row.
      const { res } = await callTokensByChain('eip155-369')
      expect(db.getCachedRequest).toHaveBeenCalled()
      expect(res.set).toHaveBeenCalledWith('cache-control', expect.stringContaining('public, max-age='))
    })
  })

  describe('cache miss — builds fresh and writes back', () => {
    beforeEach(() => {
      vi.mocked(db.getCachedRequest)
        .mockReset()
        .mockResolvedValue(undefined as never)
      vi.mocked(db.getTokensByChainRanked)
        .mockReset()
        .mockResolvedValue([] as never)
      vi.mocked(db.getTokenSourcesByChain)
        .mockReset()
        .mockResolvedValue([] as never)
      vi.mocked(db.insertCacheRequest)
        .mockReset()
        .mockResolvedValue(undefined as never)
    })

    it('serves a public cache-control (not no-store) for an ordinary cold request', async () => {
      // no-store is reserved for the admin-refresh response — an ordinary
      // visitor hitting a genuinely empty cache must still get a cacheable body.
      const { res, next } = await callTokensByChain('eip155-369')
      expect(next).not.toHaveBeenCalled()
      expect(res.set).toHaveBeenCalledWith('cache-control', expect.stringContaining('public, max-age='))
      expect(res.send).toHaveBeenCalled()
    })
  })

  describe('stale cache — serves immediately, revalidates in the background', () => {
    const staleCachedRow = () => ({
      value: '{"tokens":[]}',
      // Older than FRESH_TTL_MS (6h) but still inside STALE_TTL_MS (24h) —
      // servable now, but due for a rebuild.
      expiresAt: new Date(Date.now() + STALE_TTL_MS - 7 * 60 * 60 * 1000),
    })

    beforeEach(() => {
      vi.mocked(db.getCachedRequest)
        .mockReset()
        .mockResolvedValue(staleCachedRow() as never)
      vi.mocked(db.getTokensByChainRanked).mockReset()
      vi.mocked(db.getTokenSourcesByChain)
        .mockReset()
        .mockResolvedValue([] as never)
      vi.mocked(db.insertCacheRequest)
        .mockReset()
        .mockResolvedValue(undefined as never)
    })

    it('serves the stale body immediately and kicks off a background rebuild', async () => {
      vi.mocked(db.getTokensByChainRanked).mockResolvedValue([] as never)
      const { res, next } = await callTokensByChain('eip155-369')

      expect(next).not.toHaveBeenCalled()
      expect(res.send).toHaveBeenCalledWith('{"tokens":[]}')
      // The rebuild is fire-and-forget, so it may still be pending at this point —
      // wait for it rather than asserting synchronously.
      await vi.waitFor(() => expect(db.getTokensByChainRanked).toHaveBeenCalled())
    })

    it('logs, and does not throw, when the background revalidation build fails', async () => {
      vi.mocked(db.getTokensByChainRanked).mockRejectedValue(new Error('query timeout'))
      // The response must still succeed even though the background rebuild will fail.
      await expect(callTokensByChain('eip155-369')).resolves.toBeDefined()
      await vi.waitFor(() => expect(db.getTokensByChainRanked).toHaveBeenCalled())
    })
  })
})

describe('all handler', () => {
  it('rejects ?default=banana with 400 before any query runs — it used to 500 in Postgres', async () => {
    const res = mockResponse()
    const next = vi.fn()
    await expect(
      all({ query: { default: 'banana' } } as never, res as never, next as never) as unknown as Promise<void>,
    ).rejects.toMatchObject({ status: 400 })
    expect(res.json).not.toHaveBeenCalled()
  })

  const callAll = async (query: Record<string, unknown>) => {
    const res = mockResponse()
    await all({ query } as never, res as never, undefined as never)
    return res
  }

  it('skips the WHERE clause entirely when no filters are given', async () => {
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    await callAll({})

    expect(chain.where).not.toHaveBeenCalled()
  })

  it('builds an equality condition for a recognized scalar filter', async () => {
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    await callAll({ key: 'extended' })

    expect(chain.where).toHaveBeenCalledWith({
      op: 'and',
      conds: [{ op: 'eq', col: expect.anything(), val: 'extended' }],
    })
  })

  it('builds an inArray condition when a filter repeats as a list', async () => {
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    await callAll({ key: ['extended', 'default'] })

    expect(chain.where).toHaveBeenCalledWith({
      op: 'and',
      conds: [{ op: 'inArray', col: expect.anything(), vals: ['extended', 'default'] }],
    })
  })

  it('ignores a filter key with no matching column instead of building a bogus condition', async () => {
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    // parseListFilters passes any string key through untouched; only recognized
    // keys reach a column in getFilteredLists' map.
    await callAll({ notARealFilter: 'whatever' })

    expect(chain.where).not.toHaveBeenCalled()
  })

  it('matches a bare numeric chain_id by reference (split_part), not by exact equality', async () => {
    // ?chain_id=501 must reach solana-501 as well as any future eip155-501 — a
    // bare number carries no namespace, so it cannot be an exact-match filter.
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    await callAll({ chain_id: '501' })

    expect(chain.where).toHaveBeenCalledWith({
      op: 'and',
      conds: [
        {
          op: 'or',
          conds: [{ op: 'sql', strings: expect.any(Array), values: [expect.anything(), '501'] }],
        },
      ],
    })
  })

  it('matches an explicitly namespaced chain_id by exact equality', async () => {
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    await callAll({ chain_id: 'solana-501' })

    expect(chain.where).toHaveBeenCalledWith({
      op: 'and',
      conds: [{ op: 'or', conds: [{ op: 'eq', col: expect.anything(), val: 'solana-501' }] }],
    })
  })

  it('ORs several chain_id values together rather than requiring all of them at once', async () => {
    const chain = makeQueryChain()
    vi.mocked(getDrizzle).mockReturnValue(chain as never)

    await callAll({ chain_id: ['369', 'solana-501'] })

    const whereMock = chain.where as ReturnType<typeof vi.fn>
    const call = whereMock.mock.calls[0][0] as { conds: { conds: unknown[] }[] }
    expect(call.conds[0].conds).toHaveLength(2)
  })
})

describe('versioned handler', () => {
  const callVersioned = async (
    params: Record<string, string>,
    query: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    const res = mockResponse()
    const next = vi.fn()
    await versioned({ params, query, headers } as never, res as never, next as never)
    return { res, next }
  }

  beforeEach(() => {
    vi.mocked(listUtils.buildListPayload).mockClear()
    // Cache miss by default so the build path runs; the write is fire-and-forget.
    vi.mocked(db.getCachedRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.insertCacheRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
  })

  it('rejects with 404 when no list matches the requested version', async () => {
    // getLists returns one flat projection row per version.
    vi.mocked(db.getLists).mockResolvedValue([{ major: 1, minor: 0, patch: 0 }] as never)

    // The not-found check now lives inside the cache build, so it surfaces as a throw
    // that nextOnError forwards to next() in production.
    await expect(callVersioned({ providerKey: 'pulsex', listKey: 'extended', version: '2.0.0' })).rejects.toMatchObject(
      { status: 404 },
    )
    expect(listUtils.buildListPayload).not.toHaveBeenCalled()
  })

  it('rejects with 404 when no version segment is present at all', async () => {
    // req.params.version is undefined on a malformed request — the `|| ''`
    // fallback must produce ['', undefined, undefined] rather than throwing on split.
    vi.mocked(db.getLists).mockResolvedValue([{ major: 1, minor: 0, patch: 0 }] as never)

    await expect(callVersioned({ providerKey: 'pulsex', listKey: 'extended' })).rejects.toMatchObject({ status: 404 })
  })

  it('passes the matching version projection to the payload builder', async () => {
    // getLists now returns a flat projection sourced from the list itself (logo and
    // timestamp from the list, not from an arbitrary list_token). The matching row is
    // handed straight to buildListPayload — no per-table spread.
    vi.mocked(db.getLists).mockResolvedValue([
      {
        listId: 'l1',
        name: 'PulseX',
        imageHash: 'listlogohash',
        ext: '.png',
        mode: 'save',
        uri: null,
        updatedAt: '2024-01-01T00:00:00Z',
        major: 1,
        minor: 2,
        patch: 3,
      },
    ] as never)

    await callVersioned({ providerKey: 'pulsex', listKey: 'extended', version: '1.2.3' })

    const [list] = vi.mocked(listUtils.buildListPayload).mock.calls[0]
    expect(list).toMatchObject({ major: 1, minor: 2, patch: 3, name: 'PulseX', imageHash: 'listlogohash' })
  })
})

describe('providerKeyed handler', () => {
  const callProviderKeyed = async (
    params: Record<string, string>,
    query: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    const res = mockResponse()
    const next = vi.fn()
    await providerKeyed({ params, query, headers } as never, res as never, next as never)
    return { res, next }
  }

  beforeEach(() => {
    vi.mocked(listUtils.buildListPayload).mockClear()
    // getLists runs inside build now, so its call count must reset between tests — the
    // cache-hit test asserts it is never reached.
    vi.mocked(db.getLists).mockReset()
    // Cache miss by default so the build path runs; the write is fire-and-forget.
    vi.mocked(db.getCachedRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.insertCacheRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(bumpSubscriberCount)
      .mockReset()
      .mockResolvedValue(undefined as never)
  })

  it('rejects with the documented JSON 404 shape when no list matches', async () => {
    vi.mocked(db.getLists).mockResolvedValue([] as never)

    // The not-found check runs inside the cache build now, so it throws rather than
    // calling next directly; nextOnError forwards it in production.
    const error = (await callProviderKeyed({ providerKey: 'unknown-provider', listKey: 'extended' }).catch(
      (e) => e,
    )) as { status: number; message: string }
    expect(error.status).toBe(404)
    expect(JSON.parse(error.message)).toEqual({ providerKey: 'unknown-provider', listKey: 'extended' })
  })

  it('bumps the subscriber count for a user-submitted list', async () => {
    vi.mocked(db.getLists).mockResolvedValue([
      { list: {}, image: {}, provider: { key: 'user-abc123' }, list_token: {} },
    ] as never)

    await callProviderKeyed({ providerKey: 'user-abc123', listKey: 'default' })

    expect(bumpSubscriberCount).toHaveBeenCalledWith('user-abc123')
  })

  it('does not bump the subscriber count for a non-user-submitted list', async () => {
    vi.mocked(db.getLists).mockResolvedValue([
      { list: {}, image: {}, provider: { key: 'pulsex' }, list_token: {} },
    ] as never)

    await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' })

    expect(bumpSubscriberCount).not.toHaveBeenCalled()
  })

  it('logs and swallows a subscriber-count bump failure instead of failing the response', async () => {
    vi.mocked(db.getLists).mockResolvedValue([
      { list: {}, image: {}, provider: { key: 'user-abc123' }, list_token: {} },
    ] as never)
    vi.mocked(bumpSubscriberCount).mockRejectedValueOnce(new Error('bump failed'))

    const { next } = await callProviderKeyed({ providerKey: 'user-abc123', listKey: 'default' })

    // The response still succeeds — a subscriber-count failure is not a list-serving failure.
    expect(next).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(bumpSubscriberCount).toHaveBeenCalled())
  })

  // The point of caching this endpoint: getLists plus the per-list token join was
  // seconds on the largest lists, paid on every request. A hit must skip getLists and
  // the build entirely — which is why the key is the request's own coordinates, known
  // before any query runs, rather than the resolved list id.
  const listRows = () => [{ list: { listId: 'l1' }, image: {}, provider: { key: 'pulsex' }, list_token: {} }] as never

  it('serves a cached provider list without touching getLists or rebuilding', async () => {
    vi.mocked(db.getLists).mockResolvedValue(listRows())
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":[{"address":"0xcached"}]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)

    const { res, next } = await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' })

    expect(next).not.toHaveBeenCalled()
    // The whole point of keying on request coordinates: a hit never runs the query.
    expect(db.getLists).not.toHaveBeenCalled()
    expect(listUtils.buildListPayload).not.toHaveBeenCalled()
    expect(JSON.parse(res.send.mock.calls[0][0] as string).tokens).toEqual([{ address: '0xcached' }])
  })

  it('keys on the request coordinates and orders extensions so one request cannot fork into two', async () => {
    vi.mocked(db.getLists).mockResolvedValue(listRows())

    await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' }, { extensions: 'headerUri,bridgeInfo' })
    await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' }, { extensions: 'bridgeInfo,headerUri' })

    const [forward, reversed] = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    expect(forward).toBe(reversed)
    expect(forward).toBe(`${RESPONSE_SHAPE_VERSION}:list:pulsex:extended::bridgeInfo,headerUri::`)
  })

  it('folds the chainId and decimals filters into the key, so a filtered body is never served unfiltered', async () => {
    vi.mocked(db.getLists).mockResolvedValue(listRows())

    await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' }, { chainId: '1' })
    await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' }, {})

    const [filtered, unfiltered] = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    expect(filtered).toBe(`${RESPONSE_SHAPE_VERSION}:list:pulsex:extended:::1:`)
    expect(unfiltered).toBe(`${RESPONSE_SHAPE_VERSION}:list:pulsex:extended::::`)
    expect(filtered).not.toBe(unfiltered)
  })

  it('rejects an unauthorized refresh rather than quietly serving the cache', async () => {
    // Provider lists are the same expensive assembly as merged; an open refresh would
    // let anyone force the full per-list join on every request.
    vi.mocked(db.getLists).mockResolvedValue(listRows())

    const { res, next } = await callProviderKeyed({ providerKey: 'pulsex', listKey: 'extended' }, { refresh: '1' })

    expect((next.mock.calls[0][0] as { status: number }).status).toBe(401)
    expect(db.getCachedRequest).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('rebuilds, rewrites, and marks no-store for an authorized refresh', async () => {
    vi.mocked(db.getLists).mockResolvedValue(listRows())
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"tokens":[{"address":"0xstale"}]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)

    const { res, next } = await callProviderKeyed(
      { providerKey: 'pulsex', listKey: 'extended' },
      { refresh: '1' },
      { authorization: 'Bearer test-admin-token' },
    )

    expect(next).not.toHaveBeenCalled()
    // The persisted row is bypassed, the body is rebuilt, and the rebuild is written
    // back so the next ordinary visitor gets the fresh value too.
    expect(db.getCachedRequest).not.toHaveBeenCalled()
    expect(listUtils.buildListPayload).toHaveBeenCalled()
    expect(db.insertCacheRequest).toHaveBeenCalled()
    expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
  })
})

describe('search handler', () => {
  /** One matching token as searchTokens returns it, before normalizeTokens shapes it. */
  const matchRow = (overrides: Record<string, unknown> = {}) => ({
    chainId: 'eip155-369',
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

  beforeEach(() => {
    vi.mocked(db.getCachedRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.insertCacheRequest)
      .mockReset()
      .mockResolvedValue(undefined as never)
    vi.mocked(db.getChainIdsByReference)
      .mockReset()
      .mockResolvedValue([] as never)
    vi.mocked(db.searchTokens)
      .mockReset()
      .mockResolvedValue([] as never)
  })

  const callSearch = async (query: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const res = mockResponse()
    const next = vi.fn()
    await search({ params: {}, query, headers } as never, res as never, next as never)
    return { res, next }
  }

  /** The response body as an object; it goes out pre-serialized, as the cache stores it. */
  const searchBody = (res: ReturnType<typeof mockResponse>) => JSON.parse(res.send.mock.calls[0][0] as string)

  it('rejects a missing term before touching the database', async () => {
    const { res, next } = await callSearch({})
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toBe('q query parameter is required')
    expect(db.searchTokens).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('rejects a term that is only whitespace', async () => {
    // Trimming happens before the length check, so "   " is empty, not three characters.
    // Were it counted raw it would pass the minimum and run a search for nothing, which
    // matches every token in the table.
    const { next } = await callSearch({ q: '   ' })
    expect((next.mock.calls[0][0] as { status: number }).status).toBe(400)
    expect(db.searchTokens).not.toHaveBeenCalled()
  })

  it('rejects a repeated q parameter rather than searching for the array', async () => {
    // Express hands back an array for ?q=a&q=b. Interpolated into a query that expects a
    // string, that is a search for "a,b" — a term the caller never typed.
    const { next } = await callSearch({ q: ['usdc', 'dai'] })
    expect((next.mock.calls[0][0] as { status: number }).status).toBe(400)
    expect(db.searchTokens).not.toHaveBeenCalled()
  })

  it('rejects a single character, which cannot use the trigram indexes', async () => {
    const { next } = await callSearch({ q: 'a' })
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toContain('at least 2')
    expect(db.searchTokens).not.toHaveBeenCalled()
  })

  it('rejects a term past the length ceiling that bounds the cache key space', async () => {
    const { next } = await callSearch({ q: 'x'.repeat(65) })
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toContain('at most 64')
    expect(db.searchTokens).not.toHaveBeenCalled()
  })

  it('accepts the two-character minimum and the sixty-four character maximum', async () => {
    // The boundaries themselves, not just the values either side of them: an off-by-one
    // in either comparison rejects a term the documentation promises is valid.
    const short = await callSearch({ q: 'ab' })
    expect(short.next).not.toHaveBeenCalled()
    const long = await callSearch({ q: 'x'.repeat(64) })
    expect(long.next).not.toHaveBeenCalled()
    expect(db.searchTokens).toHaveBeenCalledTimes(2)
  })

  it('searches the trimmed term, not the raw one', async () => {
    await callSearch({ q: '  usdc  ' })
    expect(db.searchTokens).toHaveBeenCalledWith('usdc', expect.anything(), expect.anything())
  })

  it('asks for one token more than requested, so truncation is known without a second count', async () => {
    await callSearch({ q: 'usdc', limit: '2' })
    expect(db.searchTokens).toHaveBeenCalledWith('usdc', expect.anything(), expect.objectContaining({ limit: 3 }))
  })

  it('reports truncation and returns exactly the requested count', async () => {
    vi.mocked(db.searchTokens).mockResolvedValue([
      matchRow({ providedId: '0x1111111111111111111111111111111111111111' }),
      matchRow({ providedId: '0x2222222222222222222222222222222222222222' }),
      matchRow({ providedId: '0x3333333333333333333333333333333333333333' }),
    ] as never)
    const { res } = await callSearch({ q: 'usdc', limit: '2' })
    const body = searchBody(res)
    expect(body.truncated).toBe(true)
    expect(body.tokens).toHaveLength(2)
    // No total. The candidate cap means the true count is not known, and a field named
    // for it would be built on by anyone writing pagination against this endpoint.
    expect(body).not.toHaveProperty('total')
  })

  it('reports no truncation when the extra token was not there', async () => {
    vi.mocked(db.searchTokens).mockResolvedValue([
      matchRow(),
      matchRow({ providedId: '0x2222222222222222222222222222222222222222' }),
    ] as never)
    const { res } = await callSearch({ q: 'usdc', limit: '2' })
    const body = searchBody(res)
    expect(body.truncated).toBe(false)
    expect(body.tokens).toHaveLength(2)
  })

  it('clamps an oversized limit to the candidate cap', async () => {
    await callSearch({ q: 'usdc', limit: '999999' })
    expect(db.searchTokens).toHaveBeenCalledWith(
      'usdc',
      expect.anything(),
      expect.objectContaining({ limit: SEARCH_CANDIDATE_CAP + 1 }),
    )
  })

  it('falls back to the default limit for a junk value rather than forking the cache', async () => {
    await callSearch({ q: 'usdc', limit: 'banana' })
    expect(db.searchTokens).toHaveBeenCalledWith('usdc', expect.anything(), expect.objectContaining({ limit: 101 }))
  })

  it('searches every chain when none is named', async () => {
    await callSearch({ q: 'usdc' })
    const options = vi.mocked(db.searchTokens).mock.calls[0][2] as { chainId?: string }
    expect(options.chainId).toBeUndefined()
    const body = searchBody((await callSearch({ q: 'usdc' })).res)
    // The scoped identifier is stated only when the search was scoped, so a caller can
    // tell an unfiltered search from one filtered to a chain it did not ask for.
    expect(body).not.toHaveProperty('chainIdentifier')
  })

  it('resolves a bare chain number against stored identifiers instead of assuming eip155', async () => {
    // The failure this prevents: a bare 501 assumed to be eip155-501 reached past Solana
    // and answered an empty result for a chain that holds 9,633 tokens.
    vi.mocked(db.getChainIdsByReference).mockResolvedValue([{ chainId: 'solana-501', hasTokens: true }] as never)
    const { res } = await callSearch({ q: 'usdc', chainId: '501' })
    const options = vi.mocked(db.searchTokens).mock.calls[0][2] as { chainId?: string }
    expect(options.chainId).toBe('solana-501')
    expect(searchBody(res).chainIdentifier).toBe('solana-501')
  })

  it('rejects a bare chain number claimed by several namespaces', async () => {
    // Neither candidate is the eip155 form the bare number canonicalizes to — with that
    // form present the resolution is not ambiguous, it just picks it.
    vi.mocked(db.getChainIdsByReference).mockResolvedValue([
      { chainId: 'solana-42', hasTokens: true },
      { chainId: 'tvm-42', hasTokens: true },
    ] as never)
    const { next } = await callSearch({ q: 'usdc', chainId: '42' })
    const error = next.mock.calls[0][0] as { status: number; message: string }
    expect(error.status).toBe(400)
    expect(error.message).toContain('ambiguous')
    expect(db.searchTokens).not.toHaveBeenCalled()
  })

  it('treats an empty chainId as no filter rather than as a chain named ""', async () => {
    await callSearch({ q: 'usdc', chainId: '' })
    const options = vi.mocked(db.searchTokens).mock.calls[0][2] as { chainId?: string }
    expect(options.chainId).toBeUndefined()
  })

  it('rejects an unauthorized refresh instead of quietly serving a cached body', async () => {
    // Same reasoning as the chain-scoped endpoints: a caller who believes they verified
    // against fresh data must never be wrong about that.
    const { res, next } = await callSearch({ q: 'usdc', refresh: '1' })
    expect((next.mock.calls[0][0] as { status: number }).status).toBe(401)
    expect(db.searchTokens).not.toHaveBeenCalled()
    expect(res.send).not.toHaveBeenCalled()
  })

  it('keys the cache case-insensitively, because every predicate behind it is', async () => {
    await callSearch({ q: 'USDC' })
    await callSearch({ q: 'usdc' })
    const keys = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    expect(keys[0]).toBe(keys[1])
  })

  it('encodes the term into the cache key so a colon cannot forge a chain filter', async () => {
    // `search:<order>:<term>:<chainId>:<limit>`. Unencoded, the term "a:b" with no chain
    // filter and the term "a" on chain "b" collapse to one key and are served each
    // other's results.
    await callSearch({ q: 'a:b' })
    vi.mocked(db.getChainIdsByReference).mockResolvedValue([] as never)
    await callSearch({ q: 'ab', chainId: 'eip155-1' })
    const keys = vi.mocked(db.getCachedRequest).mock.calls.map(([key]) => key)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0]).toContain('a%3Ab')
  })

  it('serves a cached body without running the query', async () => {
    vi.mocked(db.getCachedRequest).mockResolvedValue({
      value: '{"query":"usdc","truncated":false,"tokens":[]}',
      expiresAt: new Date(Date.now() + STALE_TTL_MS),
    } as never)
    const { res, next } = await callSearch({ q: 'usdc' })
    expect(next).not.toHaveBeenCalled()
    expect(db.searchTokens).not.toHaveBeenCalled()
    expect(res.send).toHaveBeenCalledWith('{"query":"usdc","truncated":false,"tokens":[]}')
  })

  it('echoes the term as searched, so a caller can match a response to a keystroke', async () => {
    const { res } = await callSearch({ q: '  Usdc ' })
    expect(searchBody(res).query).toBe('Usdc')
  })

  it('still answers before the startup sync has resolved an order', async () => {
    // Search is reachable the moment the server accepts requests, which is earlier than
    // the ranking sync finishes. Passing an id that matches no list_order_item leaves
    // every list ranked equally and results fall back to version and key order —
    // degraded, still correct, and never a 500 on a cold boot. It self-corrects because
    // the order id is part of the cache key, so the degraded bodies are simply never
    // read again once the sync lands.
    vi.mocked(getDefaultListOrderId).mockReturnValueOnce(undefined as never)
    const { res, next } = await callSearch({ q: 'usdc' })
    expect(next).not.toHaveBeenCalled()
    expect(db.searchTokens).toHaveBeenCalledWith('usdc', '0x', expect.anything())
    expect(res.send).toHaveBeenCalled()
  })
})
