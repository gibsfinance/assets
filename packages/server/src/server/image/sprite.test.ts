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
  let svgContent: Buffer

  beforeAll(async () => {
    pngContent = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } },
    })
      .png()
      .toBuffer()
    svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
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

  describe('manifest ?content=mixed', () => {
    it('inlines an SVG token as a base64 data URI instead of a grid cell', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [{ address: ADDRESS, chainId: '1', imageHash: 'h1', ext: '.svg', content: svgContent, mode: 'save', uri: '' }],
      )
      const res = mockResponse()

      await manifest(mockRequest({ query: { content: 'mixed' } }), res, vi.fn())

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const key = `1-${ADDRESS.toLowerCase()}`
      expect(body.tokens[key]).toBe(`data:image/svg+xml;base64,${svgContent.toString('base64')}`)
      // An inlined SVG is not a raster cell, so it must not consume a grid slot.
      expect(body.rasterCount).toBe(0)
      expect(body.svgCount).toBe(1)
    })
  })

  describe('sheet rasterize (fetch-backed LINK-mode tokens)', () => {
    function linkToken(overrides: Record<string, unknown> = {}) {
      return {
        address: ADDRESS,
        chainId: '1',
        imageHash: 'h1',
        ext: '.png',
        content: Buffer.alloc(0),
        mode: 'link',
        uri: 'https://cdn.example.com/token.png',
        ...overrides,
      }
    }

    it('skips a token with no content and no uri (returns null, composite omitted)', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [linkToken({ uri: '' })])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      // The lone token rasterizes to nothing, so no composite is produced, but the
      // grid metadata still reflects one deduped slot — this is the 4x4 no-op case.
      expect(headerValue(res, 'x-sprite-count')).toBe('1')
      expect(res.send).toHaveBeenCalled()
    })

    it('fetches remote content for a LINK-mode token and rasterizes it', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => pngContent.buffer.slice(0) }),
      )
      queueDrizzleResults([{ listId: 'L1' }], [linkToken()])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/token.png', expect.any(Object))
      expect(res.send).toHaveBeenCalled()
    })

    it('skips a token when the remote fetch responds not-ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
      queueDrizzleResults([{ listId: 'L1' }], [linkToken()])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(res.send).toHaveBeenCalled()
    })

    it('swallows a fetch rejection and omits the token from the sheet', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
      queueDrizzleResults([{ listId: 'L1' }], [linkToken()])
      const res = mockResponse()

      // The rasterize try/catch must absorb this — a single broken remote image
      // must not fail the whole sheet for every other token in the list.
      await expect(sheet(mockRequest(), res, vi.fn())).resolves.not.toThrow()
      expect(res.send).toHaveBeenCalled()
    })
  })

  describe('resolveListId falls back to providerKey when listKey is absent', () => {
    it('manifest resolves the list using providerKey when no listKey param is present', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      const res = mockResponse()

      await manifest(mockRequest({ params: { providerKey: 'pulsex', listKey: undefined } }), res, vi.fn())

      // A resolved list (not the 404 branch) proves `listKey || providerKey` found L1.
      expect(res.status).not.toHaveBeenCalledWith(404)
    })
  })

  describe('chainId query filter', () => {
    it('manifest narrows the token query to the requested chain', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      const res = mockResponse()

      await manifest(mockRequest({ query: { chainId: '369' } }), res, vi.fn())

      const { eq } = await import('drizzle-orm')
      expect(vi.mocked(eq)).toHaveBeenCalledWith(expect.anything(), '369')
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.spriteUrl).toContain('chainId=369')
    })

    it('sheet narrows the token query to the requested chain', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      const res = mockResponse()

      await sheet(mockRequest({ query: { chainId: '369' } }), res, vi.fn())

      const { eq } = await import('drizzle-orm')
      expect(vi.mocked(eq)).toHaveBeenCalledWith(expect.anything(), '369')
    })
  })

  describe('duplicate rows within a single query result', () => {
    it('manifest counts an exact duplicate row once', async () => {
      const dupe = {
        address: ADDRESS,
        chainId: '1',
        imageHash: 'h1',
        ext: '.png',
        content: pngContent,
        mode: 'save',
        uri: '',
      }
      queueDrizzleResults([{ listId: 'L1' }], [dupe, { ...dupe }])
      const res = mockResponse()

      await manifest(mockRequest(), res, vi.fn())

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.count).toBe(1)
    })

    it('sheet counts an exact duplicate row once', async () => {
      const dupe = {
        address: ADDRESS,
        chainId: '1',
        imageHash: 'h1',
        ext: '.png',
        content: pngContent,
        mode: 'save',
        uri: '',
      }
      queueDrizzleResults([{ listId: 'L1' }], [dupe, { ...dupe }])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'x-sprite-count')).toBe('1')
    })
  })

  describe('sheet header size guard', () => {
    // Compositing 120 real images through sharp is genuinely several seconds of
    // work, and the size guard only trips with a token map this large — so the
    // budget, not the test, is what needs adjusting.
    it('omits x-sprite-tokens when the serialized position map exceeds 4KB', { timeout: 15_000 }, async () => {
      // Many distinct addresses produce a token map whose JSON serialization
      // crosses the 4096-byte proxy-safe header limit.
      const tokens = Array.from({ length: 120 }, (_, i) => ({
        address: `0x${i.toString(16).padStart(40, '0')}`,
        chainId: '1',
        imageHash: `h${i}`,
        ext: '.png',
        content: pngContent,
        mode: 'save',
        uri: '',
      }))
      queueDrizzleResults([{ listId: 'L1' }], tokens)
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'x-sprite-tokens')).toBeUndefined()
      // The sprite image itself is still produced and sent regardless of the header.
      expect(res.send).toHaveBeenCalled()
    })
  })

  describe('sheet with nothing left to render', () => {
    it('responds 204 when every token is excluded (mixed mode drops all SVGs)', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [{ address: ADDRESS, chainId: '1', imageHash: 'h1', ext: '.svg', content: svgContent, mode: 'save', uri: '' }],
      )
      const res = mockResponse()

      await sheet(mockRequest({ query: { content: 'mixed' } }), res, vi.fn())

      expect(res.status).toHaveBeenCalledWith(204)
      expect(res.end).toHaveBeenCalled()
      expect(res.send).not.toHaveBeenCalled()
    })
  })
})
