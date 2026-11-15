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

const configMock = vi.hoisted(() => ({ default: { cacheSeconds: 86400, imageStoreDirectory: '' } }))
vi.mock('../../../config', () => configMock)
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
// resize.ts imports the database index for its variant cache; the sprite tests never touch it, and loading it
// starts the terminal view, which cannot run under a test runner.
vi.mock('../../db', () => ({}))
vi.mock('../../db/schema', () => ({
  token: { networkId: 'networkId', providedId: 'providedId', tokenId: 'tokenId' },
  image: { ext: 'ext', imageHash: 'imageHash', content: 'content', mode: 'mode', uri: 'uri' },
  provider: { key: 'key', providerId: 'providerId' },
  list: { key: 'key', listId: 'listId', providerId: 'providerId' },
  listToken: {
    listId: 'listId',
    tokenId: 'tokenId',
    imageHash: 'imageHash',
    listTokenOrderId: 'listTokenOrderId',
    listTokenId: 'listTokenId',
  },
  network: { networkId: 'networkId', imageHash: 'imageHash', chainId: 'chainId' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  asc: vi.fn((...args: unknown[]) => ({ op: 'asc', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  ne: vi.fn((...args: unknown[]) => ({ op: 'ne', args })),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SPRITE_INDEX_SECONDS,
  SPRITE_INLINE_VECTOR_BYTE_LIMIT,
  SPRITE_VERSIONED_SHEET_SECONDS,
  createSheetHandler,
  manifest,
  plateLayerDocument,
  readSpriteRequest,
  sheet,
  spriteKey,
  stylesheet,
} from './sprite'
import { createSpriteBudget, createSpriteGate } from './sprite-budget'
import { IMAGE_SECURITY_HEADERS } from './headers'
import { REMOTE_IMAGE_CONCURRENCY, REMOTE_IMAGE_MAX_BYTES, REMOTE_IMAGE_SHED, sharedRemoteImages } from './remote-image'
import { LICENSE_LINK_HEADER } from './attribution'
import { getDrizzle } from '../../db/drizzle'
import { asc, sql } from 'drizzle-orm'
import { getImageStore, resetImageStoreForTests } from '../../image-store'
import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Request, Response } from 'express'

/** Golden sprite keys shared with @gibs/sdk — see fixtures/sprite-key-contract.json */
const spriteKeyContract = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../fixtures/sprite-key-contract.json', import.meta.url)), 'utf8'),
) as { entries: { note: string; chainId: string; address: string; key: string }[] }

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

/**
 * The published half of the sprite contract.
 *
 * @gibs/sdk reads these keys back and cannot import this module, so the shared
 * fixture is the only thing pairing the two. It exists because the software
 * development kit spent months building `1-0x…` against a manifest serving
 * `eip155-1-0x…` — every lookup missed, and its own suite stayed green because
 * the fixture manifest it asserted against was hand-written in a shape this
 * server has never emitted. A key format change now fails here, in the software
 * development kit suite, or in both — never silently in neither.
 */
describe('sprite key contract (shared fixture)', () => {
  for (const entry of spriteKeyContract.entries) {
    it(`emits ${entry.key} — ${entry.note}`, () => {
      expect(spriteKey({ chainId: entry.chainId, address: entry.address })).toBe(entry.key)
    })
  }

  it('always leads with the namespaced identifier, never the bare reference', () => {
    for (const entry of spriteKeyContract.entries) {
      expect(entry.key.startsWith(`${entry.chainId}-`)).toBe(true)
      expect(/^\d+-/.test(entry.key)).toBe(false)
    }
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
    // The shared reader of remote images caches by address; every test starts without that memory.
    sharedRemoteImages.reset()
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
        [`eip155-1-${ADDRESS.toLowerCase()}`]: [0, 0],
        [`eip155-369-${ADDRESS.toLowerCase()}`]: [1, 0],
      })
    })

    it('sheet dedupes by chainId-address like the manifest (regression: bare-address dedupe dropped chains)', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'x-sprite-count')).toBe('2')
      expect(headerValue(res, 'content-security-policy')).toBe(
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      )
      expect(headerValue(res, 'x-content-type-options')).toBe('nosniff')
      const tokenMap = JSON.parse(headerValue(res, 'x-sprite-tokens')!)
      expect(tokenMap).toEqual({
        [`eip155-1-${ADDRESS.toLowerCase()}`]: [0, 0],
        [`eip155-369-${ADDRESS.toLowerCase()}`]: [1, 0],
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
      const key = `eip155-1-${ADDRESS.toLowerCase()}`
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
        vi.fn(async () => new Response(new Uint8Array(pngContent))),
      )
      queueDrizzleResults([{ listId: 'L1' }], [linkToken()])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(global.fetch).toHaveBeenCalledWith('https://cdn.example.com/token.png', expect.any(Object))
      expect(res.send).toHaveBeenCalled()
    })

    it('never fetches a link-only host image and leaves its cell empty while other cells render', async () => {
      const debankUri = 'https://static.debank.com/image/token/logo.png'
      const fetchMock = vi.fn(async () => new Response(new Uint8Array(pngContent)))
      vi.stubGlobal('fetch', fetchMock)
      const stored = linkToken({
        address: '0x00000000000000000000000000000000000000BB',
        content: pngContent,
        mode: 'stored',
        uri: '',
      })
      queueDrizzleResults([{ listId: 'L1' }], [linkToken({ uri: debankUri }), stored])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(fetchMock).not.toHaveBeenCalledWith(debankUri, expect.anything())
      expect(fetchMock).not.toHaveBeenCalled()
      const size = 32
      const { data, info } = await sharp((res.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const alphaAt = (cellX: number) => data[((size / 2) * info.width + cellX * size + size / 2) * 4 + 3]
      expect(alphaAt(0)).toBe(0)
      expect(alphaAt(1)).toBeGreaterThan(0)
      // The empty cell keeps its slot, so the sheet still agrees with the manifest.
      expect(headerValue(res, 'x-sprite-count')).toBe('2')
      const tokenMap = JSON.parse(headerValue(res, 'x-sprite-tokens')!)
      expect(Object.values(tokenMap)).toEqual([
        [0, 0],
        [1, 0],
      ])
    })

    it('skips a token when the remote fetch responds not-ok', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('nope', { status: 500 })),
      )
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
    /** Alpha of the sheet's centre pixel in cell `cellX` of the first row. */
    async function alphaOfCell(res: Response, cellX: number): Promise<number> {
      const { data, info } = await sharp((res.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      return data[(16 * info.width + cellX * 32 + 16) * 4 + 3]
    }

    const storedToken = () =>
      linkToken({ address: '0x00000000000000000000000000000000000000BB', content: pngContent, mode: 'stored', uri: '' })

    it('does not read a remote body past the size cap, and leaves the cell empty', async () => {
      let pulled = 0
      const chunk = new Uint8Array(64 * 1024)
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += chunk.length
          controller.enqueue(chunk)
        },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body)),
      )
      queueDrizzleResults([{ listId: 'L1' }], [linkToken(), storedToken()])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(pulled).toBeLessThanOrEqual(REMOTE_IMAGE_MAX_BYTES + 2 * chunk.length)
      expect(await alphaOfCell(res, 0)).toBe(0)
      expect(await alphaOfCell(res, 1)).toBeGreaterThan(0)
      expect(headerValue(res, 'x-sprite-count')).toBe('2')
    })

    it('leaves a cell empty when the bytes cannot be decoded, and still draws the others', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [linkToken({ content: Buffer.from('not an image at all'), mode: 'stored', uri: '' }), storedToken()],
      )
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(await alphaOfCell(res, 0)).toBe(0)
      expect(await alphaOfCell(res, 1)).toBeGreaterThan(0)
    })

    it('does not keep a sheet that has a cell empty only because the download line was full', async () => {
      vi.spyOn(sharedRemoteImages, 'load').mockResolvedValueOnce(REMOTE_IMAGE_SHED)
      queueDrizzleResults([{ listId: 'L1' }], [linkToken(), storedToken()])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(await alphaOfCell(res, 0)).toBe(0)
      expect(await alphaOfCell(res, 1)).toBeGreaterThan(0)
      expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
      expect(res.set).not.toHaveBeenCalledWith('cache-control', expect.stringContaining('max-age'))
    })

    it('still keeps a sheet whose empty cell is a genuinely refused image', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('this is not a vector document <<<')),
      )
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [linkToken({ ext: '.svg', uri: 'https://cdn.example.com/bad.svg' }), storedToken()],
      )
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(res.set).toHaveBeenCalledWith('cache-control', expect.stringContaining('max-age'))
    })

    it('turns a vector file the sanitizer refuses into an empty cell', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('this is not a vector document <<<')),
      )
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [linkToken({ ext: '.svg', uri: 'https://cdn.example.com/bad.svg' }), storedToken()],
      )
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(await alphaOfCell(res, 0)).toBe(0)
      expect(await alphaOfCell(res, 1)).toBeGreaterThan(0)
    })

    it('shares one download limit across concurrent sheet requests', async () => {
      let running = 0
      let peak = 0
      const release: (() => void)[] = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          running++
          peak = Math.max(peak, running)
          await new Promise<void>((resolve) => release.push(resolve))
          running--
          return new Response(new Uint8Array(pngContent))
        }),
      )
      const tokensFor = (group: string) =>
        Array.from({ length: 4 }, (_, i) =>
          linkToken({
            address: `0x${group}${i.toString(16).padStart(39, '0')}`,
            uri: `https://cdn.example.com/${group}${i}.png`,
          }),
        )
      // Each handler asks the database for its list first, then its tokens, so the two
      // requests are started with their own queued results, one after the other.
      const requests: Promise<void>[] = []
      for (const group of ['a', 'b']) {
        queueDrizzleResults([{ listId: 'L1' }], tokensFor(group))
        requests.push(sheet(mockRequest(), mockResponse(), vi.fn()) as Promise<void>)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      await vi.waitFor(() => expect(running).toBe(REMOTE_IMAGE_CONCURRENCY))
      // Released until every request has finished. Stopping when nothing is running would race the
      // next queued download, which starts a moment after the last one ends, and leave it held.
      let finished = false
      const allDone = Promise.all(requests).then(() => {
        finished = true
      })
      while (!finished) {
        release.splice(0).forEach((resolve) => resolve())
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      await allDone
      // Eight downloads were wanted by two requests; the limit is one budget, not one per request.
      expect(peak).toBe(REMOTE_IMAGE_CONCURRENCY)
    })

    it('sets the image security headers on the sheet', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      for (const [name, value] of Object.entries(IMAGE_SECURITY_HEADERS)) expect(headerValue(res, name)).toBe(value)
    })
  })

  describe('licence pointer', () => {
    it('manifest carries the terms link header', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()

      await manifest(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'link')).toBe(LICENSE_LINK_HEADER)
      expect(headerValue(res, 'link')).toContain('rel="license"')
    })

    it('sheet carries the terms link header', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'link')).toBe(LICENSE_LINK_HEADER)
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

  /**
   * `network.chain_id` holds CAIP-2 identifiers, so equality against a bare number
   * matched nothing and the filter silently emptied the sprite. `SpriteOptions.chainId`
   * was typed `number`, so a bare number was the ONLY value the software development
   * kit could send — its chain filter had never once narrowed to a real chain.
   * Verified against staging before the fix: ?chainId=501 and ?chainId=42161 both
   * returned count 0 on lists holding thousands of those chains' tokens.
   */
  describe('chainId query filter', () => {
    it('manifest matches a bare number on the stored identifier reference, not by equality', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      const res = mockResponse()

      await manifest(mockRequest({ query: { chainId: '369' } }), res, vi.fn())

      const { eq, sql } = await import('drizzle-orm')
      // A bare reference is a split_part() comparison; equality against '369' would
      // only ever match a row whose identifier IS "369", and none is stored that way.
      expect(vi.mocked(sql)).toHaveBeenCalled()
      expect(vi.mocked(eq)).not.toHaveBeenCalledWith(expect.anything(), '369')
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.spriteUrl).toContain('chainId=369')
    })

    it('manifest matches an explicit identifier exactly, so solana-501 never widens', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      const res = mockResponse()

      await manifest(mockRequest({ query: { chainId: 'solana-501' } }), res, vi.fn())

      const { eq } = await import('drizzle-orm')
      expect(vi.mocked(eq)).toHaveBeenCalledWith(expect.anything(), 'solana-501')
    })

    it('sheet narrows the token query the same way the manifest does', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      const res = mockResponse()

      await sheet(mockRequest({ query: { chainId: 'solana-501' } }), res, vi.fn())

      const { eq } = await import('drizzle-orm')
      expect(vi.mocked(eq)).toHaveBeenCalledWith(expect.anything(), 'solana-501')
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

  describe('bytes kept in the image store', () => {
    let storeRoot: string

    beforeAll(async () => {
      storeRoot = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'sprite-store-'))
      configMock.default.imageStoreDirectory = storeRoot
      resetImageStoreForTests()
    })

    /** A row as the sprite query returns it once its bytes are in the store. */
    const exportedRow = async (bytes: Buffer, overrides: Record<string, unknown> = {}) => {
      const stored = await getImageStore().put(bytes)
      return {
        address: ADDRESS,
        chainId: '1',
        imageHash: `h-${stored.sha256.slice(0, 8)}`,
        ext: '.png',
        content: null,
        contentSha256: stored.sha256,
        mode: 'save',
        uri: '',
        ...overrides,
      }
    }

    it('inlines an SVG from its file in a mixed manifest', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [await exportedRow(svgContent, { ext: '.svg' })])
      const res = mockResponse()

      await manifest(mockRequest({ query: { content: 'mixed' } }), res, vi.fn())

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.tokens[`eip155-1-${ADDRESS.toLowerCase()}`]).toBe(
        `data:image/svg+xml;base64,${svgContent.toString('base64')}`,
      )
    })

    it('leaves an SVG whose file is missing out of the manifest, and moves no raster', async () => {
      const row = await exportedRow(svgContent, { ext: '.svg', contentSha256: 'd'.repeat(64) })
      queueDrizzleResults([{ listId: 'L1' }], [row])
      const res = mockResponse()

      await manifest(mockRequest({ query: { content: 'mixed' } }), res, vi.fn())

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.tokens).toEqual({})
      expect(body.count).toBe(0)
    })

    it('leaves an SVG that carries empty bytes out of the manifest, rather than giving an empty data address', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [{ ...(await exportedRow(svgContent, { ext: '.svg' })), content: Buffer.alloc(0), contentSha256: null }],
      )
      const res = mockResponse()

      await manifest(mockRequest({ query: { content: 'mixed' } }), res, vi.fn())

      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.tokens).toEqual({})
    })

    it('reads no file for a manifest that is not mixed, and for rasters in a mixed one', async () => {
      const raster = await exportedRow(pngContent)
      const get = vi.spyOn(getImageStore(), 'get')
      queueDrizzleResults([{ listId: 'L1' }], [raster])
      await manifest(mockRequest(), mockResponse(), vi.fn())
      queueDrizzleResults([{ listId: 'L1' }], [raster])
      await manifest(mockRequest({ query: { content: 'mixed' } }), mockResponse(), vi.fn())

      expect(get).not.toHaveBeenCalled()
      get.mockRestore()
    })

    it('asks the database for the bytes a row still carries only in a mixed manifest', async () => {
      const selectsNullInsteadOfBytes = async (query: Record<string, string>) => {
        vi.mocked(sql).mockClear()
        queueDrizzleResults([{ listId: 'L1' }], [])
        await manifest(mockRequest({ query }), mockResponse(), vi.fn())
        return vi.mocked(sql).mock.calls.some((call) => String(call[0]).includes('NULL::bytea'))
      }

      expect(await selectsNullInsteadOfBytes({})).toBe(true)
      expect(await selectsNullInsteadOfBytes({ content: 'mixed' })).toBe(false)
    })

    it('draws a raster cell from its file in the sheet', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [await exportedRow(pngContent)])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      const { data, info } = await sharp((res.send as ReturnType<typeof vi.fn>).mock.calls[0][0])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      expect(data[((32 / 2) * info.width + 32 / 2) * 4 + 3]).toBeGreaterThan(0)
    })

    it('leaves the cell empty, and the grid as it was, when the file is missing and there is no address to fetch', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [await exportedRow(pngContent, { contentSha256: 'e'.repeat(64) })])
      const res = mockResponse()

      await sheet(mockRequest(), res, vi.fn())

      expect(headerValue(res, 'x-sprite-count')).toBe('1')
      expect(res.send).toHaveBeenCalled()
    })
  })

  describe('list order', () => {
    it('orders by list position, then chain, then address, then the entry id, so the limit cuts the same rows everywhere', async () => {
      queueDrizzleResults([{ listId: 'L1' }], [])
      await manifest(mockRequest(), mockResponse(), vi.fn())
      expect(vi.mocked(asc).mock.calls).toEqual([['listTokenOrderId'], ['chainId'], ['providedId'], ['listTokenId']])
    })
  })

  describe('readSpriteRequest validation', () => {
    it('reads a gap, a plate and a pinned version', () => {
      const parsed = readSpriteRequest({ gap: '4', bg: '1A2B3C', shape: 'Square', v: 'abc' })
      expect(parsed.settings.gap).toBe(4)
      expect(parsed.settings.plate).toEqual({ colour: '1a2b3c', shape: 'square', contrast: null })
      expect(parsed.plate).not.toBeNull()
      expect(parsed.version).toBe('abc')
    })

    it('takes no gap, plate or version when none is given', () => {
      const parsed = readSpriteRequest({})
      expect(parsed.settings.gap).toBe(0)
      expect(parsed.settings.plate).toBeNull()
      expect(parsed.plate).toBeNull()
      expect(parsed.version).toBeNull()
    })

    it('reads a contrast tone and a chain, and makes no plate from a shape alone', () => {
      const parsed = readSpriteRequest({ contrast: 'light', chainId: 'solana-501', content: 'mixed' })
      expect(parsed.settings).toMatchObject({ chainId: 'solana-501', content: 'mixed' })
      expect(parsed.plate).toMatchObject({ contrast: 'light' })
      expect(readSpriteRequest({ shape: 'square' }).plate).toBeNull()
    })

    it.each([
      ['a gap above the range', { gap: '33' }],
      ['a negative gap', { gap: '-1' }],
      ['a fractional gap', { gap: '1.5' }],
      ['a gap that is not a number', { gap: 'wide' }],
      ['a gap given as a list', { gap: ['1', '2'] }],
      ['an invalid colour', { bg: 'zz' }],
      ['an invalid shape with a colour', { bg: 'ffffff', shape: 'hexagon' }],
      ['an invalid tone', { contrast: 'sideways' }],
    ])('refuses %s with a 400', (_label, query) => {
      expect(() => readSpriteRequest(query)).toThrow(expect.objectContaining({ status: 400 }))
    })

    it('names the gap in its refusal', () => {
      expect(() => readSpriteRequest({ gap: '40' })).toThrow('gap must be a whole number from 0 to 32')
    })
  })

  describe('gap and plate on the sheet', () => {
    const oneToken = () => [
      { address: ADDRESS, chainId: '1', imageHash: 'h1', ext: '.png', content: pngContent, mode: 'save', uri: '' },
    ]

    /** The colour of one pixel of a sheet, as the four channels. */
    async function pixelAt(image: Buffer, left: number, top: number): Promise<number[]> {
      const { data } = await sharp(image)
        .extract({ left, top, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      return [...data]
    }

    it('spaces the cells by the gap, so the sheet is cols times (size plus gap) wide', async () => {
      queueDrizzleResults([{ listId: 'L1' }], oneToken())
      const res = mockResponse()
      await sheet(mockRequest({ query: { size: '16', cols: '5', gap: '4' } }), res, vi.fn())
      const { width, height } = await sharp(vi.mocked(res.send).mock.calls[0][0] as Buffer).metadata()
      expect(width).toBe(5 * 20)
      expect(height).toBe(20)
    })

    it('scales the gap with the sheet, so a scale of 2 doubles it', async () => {
      queueDrizzleResults([{ listId: 'L1' }], oneToken())
      const res = mockResponse()
      await sheet(mockRequest({ query: { size: '16', cols: '5', gap: '2', scale: '2' } }), res, vi.fn())
      const { width } = await sharp(vi.mocked(res.send).mock.calls[0][0] as Buffer).metadata()
      expect(width).toBe(5 * (16 + 2) * 2)
    })

    it('paints a plate of the requested colour behind a logo, inside the cell', async () => {
      queueDrizzleResults([{ listId: 'L1' }], oneToken())
      const res = mockResponse()
      await sheet(mockRequest({ query: { size: '16', cols: '5', bg: 'ff0000' } }), res, vi.fn())
      const [red, green, , alpha] = await pixelAt(vi.mocked(res.send).mock.calls[0][0] as Buffer, 1, 8)
      expect(red).toBeGreaterThan(200)
      expect(green).toBeLessThan(60)
      expect(alpha).toBeGreaterThan(200)
    })

    it('paints a plate only on a logo that does not stand out against the page tone', async () => {
      const darkLogo = await sharp({
        create: { width: 8, height: 8, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } },
      })
        .png()
        .toBuffer()
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [
          {
            address: ADDRESS,
            chainId: '1',
            imageHash: 'dark-logo',
            ext: '.png',
            content: darkLogo,
            mode: 'save',
            uri: '',
          },
        ],
      )
      const res = mockResponse()
      await sheet(mockRequest({ query: { size: '16', cols: '5', contrast: 'dark' } }), res, vi.fn())
      const [red, green] = await pixelAt(vi.mocked(res.send).mock.calls[0][0] as Buffer, 1, 8)
      // The dark logo does not stand out on a dark page, so the plate is the light tone.
      expect(red).toBeGreaterThan(200)
      expect(green).toBeGreaterThan(200)
    })

    it('leaves a logo that stands out unplated, so the same cell stays transparent', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [
          {
            address: ADDRESS,
            chainId: '1',
            imageHash: 'bright-logo',
            ext: '.png',
            content: pngContent,
            mode: 'save',
            uri: '',
          },
        ],
      )
      const res = mockResponse()
      await sheet(mockRequest({ query: { size: '16', cols: '5', contrast: 'dark' } }), res, vi.fn())
      // No plate: the cell shows the logo's own red, not the white plate a dark page would get.
      const [red, green] = await pixelAt(vi.mocked(res.send).mock.calls[0][0] as Buffer, 1, 8)
      expect(red).toBeGreaterThan(150)
      expect(green).toBeLessThan(120)
      expect(headerValue(res, 'cache-control')).toMatch(/^public/)
    })

    it('does not keep a sheet whose plate could not be measured', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [
          {
            address: ADDRESS,
            chainId: '1',
            imageHash: 'unreadable-logo',
            ext: '.png',
            content: Buffer.from('not an image'),
            mode: 'save',
            uri: '',
          },
        ],
      )
      const res = mockResponse()
      await sheet(mockRequest({ query: { size: '16', cols: '5', contrast: 'dark' } }), res, vi.fn())
      expect(headerValue(res, 'cache-control')).toBe('no-store')
    })

    it('draws every plate in one layer, one circle per plated cell', () => {
      const red = { red: 255, green: 0, blue: 0, alpha: 1 }
      const layer = plateLayerDocument(
        [
          { left: 0, top: 0, plate: { colour: red, shape: 'circle' } },
          { left: 20, top: 0, plate: { colour: red, shape: 'circle' } },
        ],
        { sheetWidth: 40, sheetHeight: 20, cellPixels: 16 } as never,
      )
      expect(layer.match(/<circle/g)).toHaveLength(2)
      expect(layer).toContain('translate(20 0) scale(0.16)')
    })
  })

  describe('versions and the stylesheet', () => {
    it('pins the version in the sheet and stylesheet addresses the manifest gives', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()
      await manifest(mockRequest({ query: { gap: '2', bg: 'ff0000' } }), res, vi.fn())
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.version).toMatch(/^[0-9a-f]{14}$/)
      expect(body.spriteUrl).toContain(`v=${body.version}`)
      expect(body.stylesheetUrl).toContain(`v=${body.version}`)
      expect(body.spriteUrl).toContain('gap=2')
      expect(body.gap).toBe(2)
      expect(body.plate).toEqual({ colour: 'ff0000', shape: 'circle', contrast: null })
    })

    it('answers 409 to a sheet that names a layout no longer current, and never redirects', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()
      await sheet(mockRequest({ query: { v: 'stale' } }), res, vi.fn())
      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ version: expect.any(String) })
    })

    it('answers 409 to a stylesheet that names a layout no longer current', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()
      await stylesheet(mockRequest({ query: { v: 'stale' } }), res, vi.fn())
      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('serves the sheet when the pinned version is the current one', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const first = mockResponse()
      await manifest(mockRequest(), first, vi.fn())
      const { version } = (first.json as ReturnType<typeof vi.fn>).mock.calls[0][0]

      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()
      await sheet(mockRequest({ query: { v: version } }), res, vi.fn())
      expect(res.status).not.toHaveBeenCalledWith(409)
      expect(res.send).toHaveBeenCalled()
    })

    it('writes the base rule at the pitch, and each token rule at its cell position', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()
      await stylesheet(mockRequest({ query: { size: '16', cols: '5', gap: '4' } }), res, vi.fn())
      const css = vi.mocked(res.send).mock.calls[0][0] as string
      expect(css).toContain('background-size: 100px auto;')
      expect(css).toContain('background-position: 0px 0px;')
      expect(css).toContain('background-position: -20px 0px;')
    })

    it('sends the stylesheet as text, marked not to be sniffed', async () => {
      queueDrizzleResults([{ listId: 'L1' }], multiChainTokens())
      const res = mockResponse()
      await stylesheet(mockRequest(), res, vi.fn())
      expect(headerValue(res, 'content-type')).toBe('text/css; charset=utf-8')
      expect(headerValue(res, 'x-content-type-options')).toBe('nosniff')
    })

    it('gives a vector its picture inside a plate when the picture can be drawn', async () => {
      const framed = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>')
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [{ address: ADDRESS, chainId: '1', imageHash: 'v1', ext: '.svg', content: framed, mode: 'save', uri: '' }],
      )
      const res = mockResponse()
      await manifest(mockRequest({ query: { content: 'mixed', bg: '00ff00' } }), res, vi.fn())
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const address = String(body.tokens[`eip155-1-${ADDRESS.toLowerCase()}`])
      const picture = Buffer.from(address.split(',')[1], 'base64').toString()
      expect(picture).toContain('<circle cx="50"')
      expect(res.set).toHaveBeenCalledWith('cache-control', expect.stringContaining('public'))
    })

    it('does not keep a manifest whose vector plate cannot be drawn, such as a vector with no viewBox', async () => {
      queueDrizzleResults(
        [{ listId: 'L1' }],
        [{ address: ADDRESS, chainId: '1', imageHash: 'v2', ext: '.svg', content: svgContent, mode: 'save', uri: '' }],
      )
      const res = mockResponse()
      await manifest(mockRequest({ query: { content: 'mixed', bg: '00ff00' } }), res, vi.fn())
      expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
    })
  })

  describe('stylesheet for an unknown list', () => {
    it('answers the JSON 404, as the manifest and sheet do', async () => {
      queueDrizzleResults([])
      const res = mockResponse()
      await stylesheet(mockRequest(), res, vi.fn())
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'unknown provider or list' })
    })
  })

  describe('capacity', () => {
    it('places no more cells than the sheet can hold at this size, gap and scale', async () => {
      const many = Array.from({ length: 400 }, (_, index) => ({
        address: `0x${String(index).padStart(40, '0')}`,
        chainId: '1',
        imageHash: `h${index}`,
        ext: '.png',
        content: pngContent,
        mode: 'save',
        uri: '',
      }))
      queueDrizzleResults([{ listId: 'L1' }], many)
      const res = mockResponse()
      await manifest(mockRequest({ query: { size: '128', cols: '50', scale: '2', limit: '2000' } }), res, vi.fn())
      const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(body.rasterCount).toBe(350)
      expect(body.rows).toBe(7)
    })
  })
})

/**
 * The shared layout contract. The software development kit computes the same version, scope and token classes
 * from the same fixture, so the two halves cannot disagree about a layout.
 */
describe('sprite layout contract (shared fixture)', () => {
  const layoutContract = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../fixtures/sprite-layout-contract.json', import.meta.url)),
      'utf8',
    ),
  ) as {
    request: Record<string, string>
    version: string
    scope: string
    classes: { className: string }[]
  }

  /** The request as a query string delivers it: every value is text. */
  const contractQuery = Object.fromEntries(
    Object.entries(layoutContract.request).map(([name, value]) => [name, String(value)]),
  )
  const contractSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')
  /** The three tokens of the fixture, as the database rows that produce its keys. */
  const contractRows = [
    { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 'eip155-1', ext: '.png' },
    { address: 'GozPNCAseytzxCR3d2k8hTsTYkr4SDpuXy2RQAZFVx2g', chainId: 'solana-501', ext: '.svg' },
    { address: '0x50f1ca62e6fb8adf438ca1f50067ab83670094a6', chainId: 'eip155-369', ext: '.png' },
  ].map((row) => ({
    ...row,
    imageHash: `h-${row.address}`,
    content: contractSvg,
    contentSha256: null,
    mode: 'save',
    uri: '',
  }))

  it('serves the version the fixture names, in the manifest and in its stylesheet address', async () => {
    queueDrizzleResults([{ listId: 'L1' }], contractRows)
    const res = mockResponse()
    await manifest(mockRequest({ query: contractQuery }), res, vi.fn())
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body.version).toBe(layoutContract.version)
    expect(body.stylesheetUrl).toContain(`v=${layoutContract.version}`)
  })

  it('writes the scope and every token class the fixture names into the stylesheet', async () => {
    queueDrizzleResults([{ listId: 'L1' }], contractRows)
    const css = mockResponse()
    await stylesheet(mockRequest({ query: contractQuery }), css, vi.fn())
    const text = vi.mocked(css.send).mock.calls[0][0] as string
    expect(text).toContain(`.${layoutContract.scope}`)
    for (const token of layoutContract.classes) {
      expect(text).toContain(`.${layoutContract.scope}.${token.className}`)
    }
  })
})

describe('sheet budget, gate and lifetimes', () => {
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
    sharedRemoteImages.reset()
  })

  const CALLER = '203.0.113.7'
  const oneRow = () => [
    { address: ADDRESS, chainId: '1', imageHash: 'h1', ext: '.png', content: pngContent, mode: 'save', uri: '' },
  ]
  const fromCaller = (query: Record<string, string> = { size: '16', cols: '5' }) => mockRequest({ ip: CALLER, query })

  it('answers 429 with no-store and a window to wait when the caller has spent their budget', async () => {
    const handler = createSheetHandler({
      budget: createSpriteBudget({ clientBudget: 0, globalBudget: 1000 }),
      gate: createSpriteGate({ limit: 1, maxQueue: 8 }),
    })
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const res = mockResponse()
    await handler(fromCaller(), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(429)
    expect(headerValue(res, 'retry-after')).toBe('60')
    expect(res.set).toHaveBeenCalledWith('cache-control', 'no-store')
  })

  it('answers 429 when the whole server has spent its budget, whoever asks', async () => {
    const handler = createSheetHandler({
      budget: createSpriteBudget({ clientBudget: 1000, globalBudget: 0 }),
      gate: createSpriteGate({ limit: 1, maxQueue: 8 }),
    })
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const res = mockResponse()
    await handler(fromCaller(), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(429)
  })

  it('answers 503 with a short wait, and draws nothing, when the sheet line is full', async () => {
    const handler = createSheetHandler({
      budget: createSpriteBudget({ clientBudget: 1000, globalBudget: 1000 }),
      gate: createSpriteGate({ limit: 0, maxQueue: 0 }),
    })
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const res = mockResponse()
    await handler(fromCaller(), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(503)
    expect(headerValue(res, 'retry-after')).toBe('2')
    expect(res.send).not.toHaveBeenCalled()
  })

  it('answers 429 when the budget is spent while the sheet waited in line, and draws nothing', async () => {
    // The budget is checked before the line and again inside it, because other sheets may have spent it while this one waited.
    const handler = createSheetHandler({
      budget: { canSpend: () => true, spend: () => false },
      gate: createSpriteGate({ limit: 1, maxQueue: 8 }),
    })
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const res = mockResponse()
    await handler(fromCaller(), res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.send).not.toHaveBeenCalled()
  })

  it('spends nothing on a sheet it does not draw: one with no cells, or one answered 409', async () => {
    const budget = createSpriteBudget({ clientBudget: 3, globalBudget: 1000 })
    const handler = createSheetHandler({ budget, gate: createSpriteGate({ limit: 1, maxQueue: 8 }) })
    queueDrizzleResults([{ listId: 'L1' }], [])
    await handler(fromCaller(), mockResponse(), vi.fn())
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    await handler(fromCaller({ size: '16', cols: '5', v: 'stale' }), mockResponse(), vi.fn())
    expect(budget.canSpend({ clientAddress: CALLER, cost: 3 })).toBe(true)
  })

  it('charges one unit for each cell an unplated sheet draws', async () => {
    const budget = createSpriteBudget({ clientBudget: 10, globalBudget: 1000 })
    const handler = createSheetHandler({ budget, gate: createSpriteGate({ limit: 1, maxQueue: 8 }) })
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    await handler(fromCaller(), mockResponse(), vi.fn())
    expect(budget.canSpend({ clientAddress: CALLER, cost: 9 })).toBe(true)
    expect(budget.canSpend({ clientAddress: CALLER, cost: 10 })).toBe(false)
  })

  it('charges a plated cell twice as much, so a plated sheet costs more than the same sheet unplated', async () => {
    const budget = createSpriteBudget({ clientBudget: 10, globalBudget: 1000 })
    const handler = createSheetHandler({ budget, gate: createSpriteGate({ limit: 1, maxQueue: 8 }) })
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    await handler(fromCaller({ size: '16', cols: '5', bg: 'ff0000' }), mockResponse(), vi.fn())
    expect(budget.canSpend({ clientAddress: CALLER, cost: 8 })).toBe(true)
    expect(budget.canSpend({ clientAddress: CALLER, cost: 9 })).toBe(false)
  })

  it('answers the manifest and the stylesheet while the sheet line is full, because they draw nothing', async () => {
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const manifestResponse = mockResponse()
    await manifest(fromCaller(), manifestResponse, vi.fn())
    expect(manifestResponse.status).not.toHaveBeenCalled()
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const styleResponse = mockResponse()
    await stylesheet(fromCaller(), styleResponse, vi.fn())
    expect(styleResponse.send).toHaveBeenCalled()
  })

  it('keeps a manifest and a stylesheet five minutes, and an unpinned sheet the same', async () => {
    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const json = mockResponse()
    await manifest(fromCaller(), json, vi.fn())
    const { version } = (json.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(SPRITE_INDEX_SECONDS).toBe(300)
    expect(headerValue(json, 'cache-control')).toBe(`public, max-age=${SPRITE_INDEX_SECONDS}`)

    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const css = mockResponse()
    await stylesheet(mockRequest(), css, vi.fn())
    expect(headerValue(css, 'cache-control')).toBe(`public, max-age=${SPRITE_INDEX_SECONDS}`)

    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const unpinned = mockResponse()
    await sheet(mockRequest({ query: { size: '16', cols: '5' } }), unpinned, vi.fn())
    expect(headerValue(unpinned, 'cache-control')).toBe(`public, max-age=${SPRITE_INDEX_SECONDS}`)

    queueDrizzleResults([{ listId: 'L1' }], oneRow())
    const pinned = mockResponse()
    await sheet(mockRequest({ query: { size: '16', cols: '5', v: version } }), pinned, vi.fn())
    expect(headerValue(pinned, 'cache-control')).toBe(`public, max-age=${SPRITE_VERSIONED_SHEET_SECONDS}`)
  })

  it('keeps a sheet pinned to its version a day, because the version names its layout', () => {
    expect(SPRITE_VERSIONED_SHEET_SECONDS).toBe(86_400)
  })

  it('inlines vectors up to the byte limit, skipping one that does not fit, and gives the stylesheet the same ones', async () => {
    const bulk = (size: number) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><!-- ${'x'.repeat(size)} --></svg>`)
    const big = Math.floor(SPRITE_INLINE_VECTOR_BYTE_LIMIT * 0.6)
    const rows = [
      {
        address: `0x${'1'.repeat(40)}`,
        chainId: '1',
        imageHash: 'a',
        ext: '.svg',
        content: bulk(big),
        mode: 'save',
        uri: '',
      },
      {
        address: `0x${'2'.repeat(40)}`,
        chainId: '1',
        imageHash: 'b',
        ext: '.svg',
        content: bulk(big),
        mode: 'save',
        uri: '',
      },
      {
        address: `0x${'3'.repeat(40)}`,
        chainId: '1',
        imageHash: 'c',
        ext: '.svg',
        content: bulk(10),
        mode: 'save',
        uri: '',
      },
    ]
    queueDrizzleResults([{ listId: 'L1' }], rows)
    const json = mockResponse()
    await manifest(mockRequest({ query: { content: 'mixed' } }), json, vi.fn())
    const { tokens } = (json.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(Object.keys(tokens).map((key) => key.slice(-4))).toEqual(['1111', '3333'])

    queueDrizzleResults([{ listId: 'L1' }], rows)
    const css = mockResponse()
    await stylesheet(mockRequest({ query: { content: 'mixed' } }), css, vi.fn())
    const text = vi.mocked(css.send).mock.calls[0][0] as string
    expect(text.match(/background-image: url\("data:/g)).toHaveLength(2)
  })
})
