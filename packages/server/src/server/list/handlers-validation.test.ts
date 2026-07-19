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
import { merged, tokensByChain, all } from './handlers'

const STALE_TTL_MS = 24 * 60 * 60 * 1000

const mockResponse = () => ({
  set: vi.fn().mockReturnThis(),
  json: vi.fn().mockReturnThis(),
  send: vi.fn().mockReturnThis(),
})

const callMerged = async (query: Record<string, unknown>) => {
  const res = mockResponse()
  const next = vi.fn()
  await merged({ params: { order: 'default' }, query } as never, res as never, next as never)
  return { res, next }
}

describe('merged handler', () => {
  beforeEach(() => {
    vi.mocked(db.getListOrderId)
      .mockReset()
      .mockResolvedValue('order-1' as never)
    vi.mocked(db.applyOrder)
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
    const bareBody = bare.res.json.mock.calls[0][0]
    const prefixedBody = prefixed.res.json.mock.calls[0][0]
    expect(bareBody.tokens).toHaveLength(1)
    expect(bareBody.tokens).toEqual(prefixedBody.tokens)
  })
})

describe('tokensByChain handler', () => {
  beforeEach(() => {
    vi.mocked(db.getCachedRequest)
      .mockReset()
      .mockResolvedValue({ value: '{"tokens":[]}', expiresAt: new Date(Date.now() + STALE_TTL_MS) } as never)
  })

  const callTokensByChain = async (chainId: string, query: Record<string, unknown> = {}) => {
    const res = mockResponse()
    const next = vi.fn()
    await tokensByChain({ params: { chainId }, query } as never, res as never, next as never)
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
    expect(db.getCachedRequest).toHaveBeenCalledWith('tokens-by-chain:eip155-369:50000:')
  })

  it('clamps oversized limits to the documented maximum', async () => {
    await callTokensByChain('369', { limit: '999999' })
    expect(db.getCachedRequest).toHaveBeenCalledWith('tokens-by-chain:eip155-369:100000:')
  })

  // End-to-end proof of the namespace fix, at the layer that broke. /stats reports
  // {chainId: "501", chainIdentifier: "solana-501"}, and feeding that bare 501 back
  // in used to read the eip155-501 cache key, which nothing ever writes — 200 with
  // zero tokens against /stats reporting 6286.
  it('reads a bare non-evm chain id from its own namespace, not eip155', async () => {
    vi.mocked(db.getChainIdsByReference).mockResolvedValueOnce([{ chainId: 'solana-501', hasTokens: true }] as never)
    await callTokensByChain('501')
    expect(db.getCachedRequest).toHaveBeenCalledWith('tokens-by-chain:solana-501:50000:')
  })

  // A phantom eip155 row must not shadow the namespace holding the tokens — the dev
  // database has exactly this pair, and migration 0008 deletes four more like it.
  it('ignores an empty eip155 row when another namespace holds the tokens', async () => {
    vi.mocked(db.getChainIdsByReference).mockResolvedValueOnce([
      { chainId: 'eip155-501', hasTokens: false },
      { chainId: 'solana-501', hasTokens: true },
    ] as never)
    await callTokensByChain('501')
    expect(db.getCachedRequest).toHaveBeenCalledWith('tokens-by-chain:solana-501:50000:')
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
    expect(db.getCachedRequest).toHaveBeenCalledWith('tokens-by-chain:solana-501:50000:')
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
})
