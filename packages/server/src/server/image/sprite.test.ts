/**
 * Sprite endpoint tests.
 *
 * Two production regressions are encoded here:
 * 1. Unknown provider/list used to `next()` into the framework's HTML 404
 *    while the API contract promises a JSON Error body.
 * 2. The sheet deduped by bare lowercase address while the manifest keys by
 *    `chainId-address` — a list carrying the same address on two chains lost
 *    cells and every later grid coordinate drifted between the two endpoints.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

vi.mock('../../../config', () => ({ default: { cacheSeconds: 86400 } }))
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
vi.mock('../../db/schema', () => ({
  token: { networkId: 'networkId', providedId: 'providedId', tokenId: 'tokenId' },
  image: { ext: 'ext', imageHash: 'imageHash', content: 'content', mode: 'mode', uri: 'uri' },
  provider: { key: 'key', providerId: 'providerId' },
  list: { key: 'key', listId: 'listId', providerId: 'providerId' },
  listToken: { listId: 'listId', tokenId: 'tokenId', imageHash: 'imageHash' },
  network: { networkId: 'networkId', imageHash: 'imageHash', chainId: 'chainId' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  ne: vi.fn((...args: unknown[]) => ({ op: 'ne', args })),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import sharp from 'sharp'
import { manifest, sheet, spriteKey } from './sprite'
import { getDrizzle } from '../../db/drizzle'
import type { Request, Response } from 'express'

describe('spriteKey', () => {
  it('lowercases Ethereum-Virtual-Machine addresses so casing never splits a cell', () => {
    // Checksummed USDC — normalizeProvidedId canonicalizes it to lowercase.
    expect(spriteKey({ chainId: 'eip155-1', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' })).toBe(
      'eip155-1-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    )
  })

  it('preserves base58 ids — the key is exposed verbatim in the manifest', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    expect(spriteKey({ chainId: 'solana-501', address: mint })).toBe(`solana-501-${mint}`)
  })
})

const ADDRESS = '0x00000000000000000000000000000000000000AA'

/** Build a chainable drizzle query builder mock resolving at `.limit()` */
function makeChain(result: unknown[]) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where', 'orderBy', '$dynamic']) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.limit = vi.fn().mockResolvedValue(result)
  return chain
}

/** Queue per-call drizzle results: first getDrizzle() call gets the first result set, etc. */
function queueDrizzleResults(...results: unknown[][]) {
  const queue = [...results]
  vi.mocked(getDrizzle).mockImplementation(() => makeChain(queue.shift() ?? []) as never)
}

function mockResponse(): Response {
  const res: Record<string, unknown> = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  res.set = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  res.end = vi.fn().mockReturnValue(res)
  return res as unknown as Response
}

function mockRequest(overrides: Record<string, unknown> = {}): Request {
  return { params: { providerKey: 'pulsex', listKey: 'extended' }, query: {}, ...overrides } as unknown as Request
}

/** Read a header value recorded on the mock response */
function headerValue(res: Response, name: string): string | undefined {
  const call = (res.set as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === name)
  return call?.[1] as string | undefined
}

describe('sprite endpoints', () => {
  let pngContent: Buffer

  beforeAll(async () => {
    pngContent = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } },
    })
      .png()
      .toBuffer()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Same token address listed on two chains — the multi-chain regression input */
  function multiChainTokens() {
    return [
      { address: ADDRESS, chainId: '1', imageHash: 'h1', ext: '.png', content: pngContent, mode: 'save', uri: '' },
      { address: ADDRESS, chainId: '369', imageHash: 'h2', ext: '.png', content: pngContent, mode: 'save', uri: '' },
    ]
  }

  describe('unknown provider or list', () => {
    it('manifest responds 404 JSON Error, never the framework HTML 404', async () => {
      queueDrizzleResults([]) // resolveListId finds nothing
      const res = mockResponse()
      const next = vi.fn()

      await manifest(mockRequest(), res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) })
    })

    it('sheet responds 404 JSON Error, never the framework HTML 404', async () => {
      queueDrizzleResults([])
      const res = mockResponse()
      const next = vi.fn()

      await sheet(mockRequest(), res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) })
    })
  })

  describe('multi-chain dedupe parity', () => {
    it('manifest keeps one cell per chain for the same address', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()

      await manifest(mockRequest(), res, vi.fn())

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.count).toBe(2)
      expect(body.tokens).toEqual({
        [`1-${ADDRESS.toLowerCase()}`]: [0, 0],
        [`369-${ADDRESS.toLowerCase()}`]: [1, 0],
      })
    })

    it('sheet dedupes by chainId-address like the manifest (regression: bare-address dedupe dropped chains)', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'x-sprite-count')).toBe('2')
      const tokenMap = JSON.parse(headerValue(res, 'x-sprite-tokens')!)
      expect(tokenMap).toEqual({
        [`1-${ADDRESS.toLowerCase()}`]: [0, 0],
        [`369-${ADDRESS.toLowerCase()}`]: [1, 0],
      })
      expect(res.send).toHaveBeenCalled()
    })

    it('manifest and sheet emit identical keys and coordinates for the same rows', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const manifestRes = mockResponse()
      await manifest(mockRequest(), manifestRes, vi.fn())

      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const sheetRes = mockResponse()
      await sheet(mockRequest(), sheetRes, vi.fn())

      const manifestTokens = (manifestRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0].tokens
      const sheetTokens = JSON.parse(headerValue(sheetRes, 'x-sprite-tokens')!)
      expect(sheetTokens).toEqual(manifestTokens)
    })
  })
})
