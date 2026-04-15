import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock heavy transitive dependencies before importing handlers
vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', () => ({
  applyOrder: vi.fn(),
  getListOrderId: vi.fn(),
}))
vi.mock('../../db/drizzle', () => ({ getDrizzle: vi.fn() }))
vi.mock('../../db/schema', () => ({
  token: { networkId: 'networkId', providedId: 'providedId', tokenId: 'tokenId' },
  image: { ext: 'ext', imageHash: 'imageHash' },
  provider: { key: 'key', providerId: 'providerId' },
  list: { key: 'key', listId: 'listId', providerId: 'providerId' },
  listToken: { listId: 'listId', tokenId: 'tokenId', imageHash: 'imageHash' },
  network: { networkId: 'networkId', imageHash: 'imageHash' },
}))
vi.mock('../../db/sync-order', () => ({ getDefaultListOrderId: vi.fn() }))
vi.mock('../../utils', () => ({
  chainIdToNetworkId: vi.fn((id: number) => `eip155:${id}`),
}))
vi.mock('../../paths', () => ({ submodules: '/submodules' }))
vi.mock('../../types', () => ({}))
vi.mock('../../../config', () => ({ default: { cacheSeconds: 86400 } }))
vi.mock('./resize', () => ({ maybeResize: vi.fn() }))
vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import {
  parseFormatPreference,
  formatToExts,
  splitExt,
  extFilter,
  resolveImageMode,
  sendImage,
  getListTokens,
  getNetworkIcon,
  getImage,
  getImageAndFallback,
  getImageByHash,
  bestGuessNetworkImageFromOnOnChainInfo,
  tryMultiple,
  queryStringToList,
  ignoreNotFound,
  validateOutputFormat,
  classifyImageServe,
  parseTypeFilter,
  MIN_SERVABLE_RASTER_SIZE,
} from './handlers'
import type { Image } from '../../db/schema-types'
import * as db from '../../db'
import { getDrizzle } from '../../db/drizzle'
import { getDefaultListOrderId } from '../../db/sync-order'
import { maybeResize } from './resize'
import type { Response, Request } from 'express'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_ADDRESS = '0x0000000000000000000000000000000000000001' as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Image-like object for tests */
function makeImage(overrides: Partial<Image> = {}): Image {
  return {
    imageHash: 'abc123',
    content: Buffer.from('x'.repeat(300)),
    uri: 'https://example.com/token.png',
    ext: '.png',
    mode: 'save',
    createdAt: null,
    ...overrides,
  } as Image
}

/** Create a mock Express Response */
function mockResponse(): Response {
  const res: Record<string, unknown> = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  res.set = vi.fn().mockReturnValue(res)
  res.contentType = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  res.redirect = vi.fn().mockReturnValue(res)
  return res as unknown as Response
}

/** Create a mock Express Request */
function mockRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request
}

/** Build a chainable drizzle query builder mock */
function makeDrizzleChain(result: unknown[] = []) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.from = vi.fn().mockReturnValue(chain)
  chain.leftJoin = vi.fn().mockReturnValue(chain)
  chain.rightJoin = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockResolvedValue(result)
  return chain
}

describe('image handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // parseFormatPreference (existing)
  // -----------------------------------------------------------------------
  describe('parseFormatPreference', () => {
    it('returns empty array for undefined', () => {
      expect(parseFormatPreference(undefined)).toEqual([])
    })

    it('returns empty array for empty string', () => {
      expect(parseFormatPreference('')).toEqual([])
    })

    it('parses a single format name', () => {
      expect(parseFormatPreference('webp')).toEqual([['.webp']])
    })

    it('parses comma-separated format names', () => {
      expect(parseFormatPreference('vector,webp,png,jpg')).toEqual([
        ['.svg', '.svg+xml', '.xml'],
        ['.webp'],
        ['.png'],
        ['.jpg', '.jpeg'],
      ])
    })

    it('handles repeated query keys (Express array form)', () => {
      // Express parses ?format=vector&format=webp as ['vector', 'webp']
      expect(parseFormatPreference(['vector', 'webp', 'png'])).toEqual([
        ['.svg', '.svg+xml', '.xml'],
        ['.webp'],
        ['.png'],
      ])
    })

    it('produces same result for comma vs repeated keys', () => {
      const fromComma = parseFormatPreference('vector,webp,png,jpg')
      const fromArray = parseFormatPreference(['vector', 'webp', 'png', 'jpg'])
      expect(fromComma).toEqual(fromArray)
    })

    it('deduplicates format names', () => {
      expect(parseFormatPreference('png,png,webp')).toEqual([['.png'], ['.webp']])
    })

    it('is case-insensitive', () => {
      expect(parseFormatPreference('PNG,WebP')).toEqual([['.png'], ['.webp']])
    })

    it('skips unknown format names', () => {
      expect(parseFormatPreference('vector,bmp,png')).toEqual([['.svg', '.svg+xml', '.xml'], ['.png']])
    })

    it('returns empty array when all names are unknown', () => {
      expect(parseFormatPreference('bmp,tiff')).toEqual([])
    })

    it('trims whitespace around names', () => {
      expect(parseFormatPreference(' png , webp ')).toEqual([['.png'], ['.webp']])
    })

    it('handles raster as a group', () => {
      expect(parseFormatPreference('raster')).toEqual([['.png', '.jpg', '.jpeg', '.webp', '.gif']])
    })

    it('treats svg and jpeg as aliases', () => {
      expect(parseFormatPreference('svg')).toEqual([['.svg', '.svg+xml']])
      expect(parseFormatPreference('jpeg')).toEqual([['.jpg', '.jpeg']])
    })
  })

  // -----------------------------------------------------------------------
  // formatToExts (existing)
  // -----------------------------------------------------------------------
  describe('formatToExts', () => {
    it('has entries for all expected format names', () => {
      const expected = ['vector', 'svg', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'raster']
      for (const name of expected) {
        expect(formatToExts.has(name)).toBe(true)
      }
    })

    it('maps vector to svg-family extensions', () => {
      expect(formatToExts.get('vector')).toEqual(['.svg', '.svg+xml', '.xml'])
    })

    it('maps raster to common raster extensions', () => {
      expect(formatToExts.get('raster')).toEqual(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
    })
  })

  // -----------------------------------------------------------------------
  // splitExt (existing)
  // -----------------------------------------------------------------------
  describe('splitExt', () => {
    it('returns filename only when no extension', () => {
      expect(splitExt('0xabc123')).toEqual({ filename: '0xabc123' })
    })

    it('splits a concrete extension', () => {
      expect(splitExt('0xabc123.png')).toEqual({
        filename: '0xabc123',
        ext: '.png',
        exts: ['.png'],
      })
    })

    it('expands .raster to all raster extensions', () => {
      const result = splitExt('0xabc123.raster')
      expect(result.filename).toBe('0xabc123')
      expect(result.ext).toBe('.raster')
      expect(result.exts).toEqual(extFilter.get('.raster'))
    })

    it('expands .vector to all vector extensions', () => {
      const result = splitExt('0xabc123.vector')
      expect(result.filename).toBe('0xabc123')
      expect(result.ext).toBe('.vector')
      expect(result.exts).toEqual(extFilter.get('.vector'))
    })
  })

  // -----------------------------------------------------------------------
  // resolveImageMode
  // -----------------------------------------------------------------------
  describe('resolveImageMode', () => {
    it('defaults to SAVE when mode is null', () => {
      expect(resolveImageMode(null)).toBe('save')
    })

    it('defaults to SAVE when mode is undefined', () => {
      expect(resolveImageMode(undefined)).toBe('save')
    })

    it('returns LINK for link mode', () => {
      expect(resolveImageMode('link')).toBe('link')
    })

    it('defaults to SAVE for unrecognized values', () => {
      expect(resolveImageMode('default')).toBe('save')
      expect(resolveImageMode('save')).toBe('save')
    })
  })

  // -----------------------------------------------------------------------
  // sendImage
  // -----------------------------------------------------------------------
  describe('sendImage', () => {
    it('sends image content with cache headers for save mode', () => {
      const res = mockResponse()
      const img = makeImage()
      sendImage(res, img, 'save')

      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
      expect(res.set).toHaveBeenCalledWith('x-resize', 'original')
      expect(res.set).toHaveBeenCalledWith('x-uri', 'https://example.com/token.png')
      expect(res.contentType).toHaveBeenCalledWith('.png')
      expect(res.send).toHaveBeenCalledWith(img.content)
    })

    it('redirects when mode is LINK and uri is http', () => {
      const res = mockResponse()
      const img = makeImage()
      sendImage(res, img, 'link')

      expect(res.redirect).toHaveBeenCalledWith('https://example.com/token.png')
    })

    it('returns 404 when content is empty and no redirect uri', () => {
      const res = mockResponse()
      const img = makeImage({ content: Buffer.from([]), uri: '' })
      sendImage(res, img, 'save')

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'image content unavailable' })
    })

    it('redirects when content is empty but redirect uri exists', () => {
      const res = mockResponse()
      const img = makeImage({ content: Buffer.from([]) })
      sendImage(res, img, 'save')

      expect(res.redirect).toHaveBeenCalledWith('https://example.com/token.png')
    })

    it('skips tiny raster content and redirects if uri available', () => {
      const res = mockResponse()
      const img = makeImage({ content: Buffer.from('tiny') }) // less than 200 bytes
      sendImage(res, img, 'save')

      expect(res.redirect).toHaveBeenCalledWith('https://example.com/token.png')
    })

    it('returns 404 for tiny raster content with no redirect uri', () => {
      const res = mockResponse()
      const img = makeImage({ content: Buffer.from('tiny'), uri: '' })
      sendImage(res, img, 'save')

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'image content unavailable' })
    })

    it('serves small SVG content (no minimum size for vectors)', () => {
      const res = mockResponse()
      const img = makeImage({ content: Buffer.from('<svg/>'), ext: '.svg' })
      sendImage(res, img, 'save')

      expect(res.contentType).toHaveBeenCalledWith('.svg')
      expect(res.send).toHaveBeenCalled()
    })

    it('serves small SVG+xml content without size check', () => {
      const res = mockResponse()
      const img = makeImage({ content: Buffer.from('<svg/>'), ext: '.svg+xml' })
      sendImage(res, img, 'save')

      expect(res.contentType).toHaveBeenCalledWith('.svg+xml')
      expect(res.send).toHaveBeenCalled()
    })

    it('sets x-uri for ipfs URIs', () => {
      const res = mockResponse()
      const img = makeImage({ uri: 'ipfs://QmHash' })
      sendImage(res, img, 'save')

      expect(res.set).toHaveBeenCalledWith('x-uri', 'ipfs://QmHash')
    })

    it('sets relative x-uri for local file paths', () => {
      const res = mockResponse()
      const img = makeImage({ uri: '/submodules/lists/token.png' })
      sendImage(res, img, 'save')

      // path.relative('/submodules', '/submodules/lists/token.png') = 'lists/token.png'
      expect(res.set).toHaveBeenCalledWith('x-uri', 'lists/token.png')
    })

    it('does not set x-uri for data URIs', () => {
      const res = mockResponse()
      const img = makeImage({ uri: 'data:image/png;base64,abc' })
      sendImage(res, img, 'save')

      // The function skips setting x-uri for data: URIs
      const setCalls = (res.set as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
      expect(setCalls).not.toContain('x-uri')
    })

    it('does not set x-uri when uri is empty', () => {
      const res = mockResponse()
      const img = makeImage({ uri: '', content: Buffer.from('x'.repeat(300)) })
      sendImage(res, img, 'save')

      const setCalls = (res.set as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
      expect(setCalls).not.toContain('x-uri')
    })
  })

  // -----------------------------------------------------------------------
  // getListTokens
  // -----------------------------------------------------------------------
  describe('getListTokens', () => {
    it('uses applyOrder when a list order is available', async () => {
      const fakeRow = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue('0xdefault' as const)
      vi.mocked(db.applyOrder).mockResolvedValue([fakeRow])

      const result = await getListTokens({
        chainId: 1,
        address: TEST_ADDRESS,
      })

      expect(db.applyOrder).toHaveBeenCalledWith('0xdefault', expect.anything(), 'provider', undefined, {
        includeContent: true,
      })
      expect(result.img).toBe(fakeRow)
      expect(result.filter.networkId).toBe('eip155:1')
    })

    it('falls back to simple drizzle query when no order id', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      const fakeRow = {
        provider: { key: 'test' },
        list: { listId: '1' },
        list_token: { tokenId: '1' },
        token: { networkId: 'eip155:1' },
        image: makeImage(),
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getListTokens({
        chainId: 1,
        address: TEST_ADDRESS,
      })

      expect(getDrizzle).toHaveBeenCalled()
      expect(result.img).toBeDefined()
    })

    it('returns undefined img when no rows match', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getListTokens({
        chainId: 1,
        address: TEST_ADDRESS,
      })

      expect(result.img).toBeUndefined()
    })

    it('passes ext filter when provided', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue('0xdefault' as const)
      vi.mocked(db.applyOrder).mockResolvedValue([makeImage()])

      await getListTokens({
        chainId: 1,
        address: TEST_ADDRESS,
        exts: ['.svg'],
      })

      expect(db.applyOrder).toHaveBeenCalled()
    })

    it('uses explicit listOrderId over default', async () => {
      vi.mocked(db.applyOrder).mockResolvedValue([makeImage()])

      await getListTokens({
        chainId: 1,
        address: TEST_ADDRESS,
        listOrderId: '0xcustom',
      })

      expect(db.applyOrder).toHaveBeenCalledWith('0xcustom', expect.anything(), 'provider', undefined, {
        includeContent: true,
      })
    })
  })

  // -----------------------------------------------------------------------
  // getNetworkIcon
  // -----------------------------------------------------------------------
  describe('getNetworkIcon', () => {
    it('returns img when a row matches', async () => {
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getNetworkIcon(1)

      expect(result.filter.networkId).toBe('eip155:1')
      expect(result.img).toBeDefined()
    })

    it('returns undefined img when no match', async () => {
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getNetworkIcon(999)

      expect(result.img).toBeUndefined()
    })

    it('applies ext filter when provided', async () => {
      const fakeRow = {
        image: makeImage({ ext: '.svg' }),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getNetworkIcon(1, ['.svg'])

      expect(result.img).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // getImage handler
  // -----------------------------------------------------------------------
  describe('getImage', () => {
    it('calls sendImage on success', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await handler(req, res, next)

      expect(res.contentType).toHaveBeenCalledWith('.png')
      expect(res.send).toHaveBeenCalled()
    })

    it('sets query.as from path extension', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: `${TEST_ADDRESS}.webp` },
        query: {},
      })
      const res = mockResponse()

      await handler(req, res, vi.fn())

      expect(req.query).toHaveProperty('as', 'webp')
    })

    it('does not override existing query.as', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: `${TEST_ADDRESS}.webp` },
        query: { as: 'png' },
      })
      const res = mockResponse()

      await handler(req, res, vi.fn())

      expect(req.query.as).toBe('png')
    })

    it('returns early when maybeResize handles the response', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS },
        query: {},
      })
      const res = mockResponse()

      await handler(req, res, vi.fn())

      // sendImage should not be called if maybeResize handled the response
      expect(res.send).not.toHaveBeenCalled()
    })

    it('passes providerKey and listKey array query params', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS },
        query: { providerKey: ['pulsex', 'uniswap'], listKey: 'default' },
      })
      const res = mockResponse()

      await handler(req, res, vi.fn())

      expect(res.send).toHaveBeenCalled()
    })

    it('passes object-style query params through toString fallback', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const handler = getImage(false)
      // ParsedQs can have nested object values — triggers toString fallback
      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS },
        query: { providerKey: { nested: 'value' } },
      })
      const res = mockResponse()

      await handler(req, res, vi.fn())

      expect(res.send).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // getImage — format validation paths
  // -----------------------------------------------------------------------
  describe('getImage format validation', () => {
    it('throws NotFound when SVG requested but source is raster', async () => {
      const img = makeImage({ ext: '.png' })
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: `${TEST_ADDRESS}.svg` },
        query: {},
      })
      const res = mockResponse()

      await expect(handler(req, res, vi.fn())).rejects.toThrow(/no SVG available/)
    })

    it('throws NotAcceptable for unsupported output format', async () => {
      const img = makeImage({ ext: '.png' })
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: `${TEST_ADDRESS}.bmp` },
        query: {},
      })
      const res = mockResponse()

      await expect(handler(req, res, vi.fn())).rejects.toThrow(/unsupported output format/)
    })

    it('throws BadRequest for invalid address', async () => {
      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: 'not-an-address' },
        query: {},
      })
      const res = mockResponse()

      await expect(handler(req, res, vi.fn())).rejects.toThrow(/address/)
    })
  })

  // -----------------------------------------------------------------------
  // getImageByHash handler
  // -----------------------------------------------------------------------
  describe('getImageByHash', () => {
    it('serves image found by hash', async () => {
      const img = makeImage()
      const chain = makeDrizzleChain([img])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        params: { imageHash: 'abc123.png' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      expect(res.contentType).toHaveBeenCalledWith('.png')
    })

    it('calls next with 404 when hash not found', async () => {
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        params: { imageHash: 'missing.png' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
    })
  })

  // -----------------------------------------------------------------------
  // bestGuessNetworkImageFromOnOnChainInfo handler
  // -----------------------------------------------------------------------
  describe('bestGuessNetworkImageFromOnOnChainInfo', () => {
    it('serves network icon when found', async () => {
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        params: { chainId: '1' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await bestGuessNetworkImageFromOnOnChainInfo(req, res, next)

      expect(res.send).toHaveBeenCalled()
    })

    it('throws 404 when network icon not found', async () => {
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        params: { chainId: '999' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await expect(bestGuessNetworkImageFromOnOnChainInfo(req, res, next)).rejects.toThrow(
        /best guess network image not found/,
      )
    })

    it('throws NotFound for unknown chainId', async () => {
      const req = mockRequest({
        params: { chainId: 'abc' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await expect(bestGuessNetworkImageFromOnOnChainInfo(req, res, next)).rejects.toThrow(/not found/)
    })
  })

  // -----------------------------------------------------------------------
  // getImageAndFallback handler
  // -----------------------------------------------------------------------
  describe('getImageAndFallback', () => {
    it('sets req.query.format from outputExt when present', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      // Return data with a .webp extension on the address param
      const chainSuccess = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chainSuccess as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        params: { chainId: '1', address: `${TEST_ADDRESS}.webp`, order: 'someorder' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageAndFallback(req, res, next)

      expect(req.query).toHaveProperty('format', 'webp')
    })

    it('does not override existing req.query.format', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      const chainSuccess = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chainSuccess as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        params: { chainId: '1', address: `${TEST_ADDRESS}.webp`, order: 'someorder' },
        query: { format: 'png' },
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageAndFallback(req, res, next)

      expect(req.query.format).toBe('png')
    })

    it('throws when both ordered and unordered queries find nothing', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS, order: 'someorder' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      // The second getListImage(false) call throws NotFound (no .catch)
      await expect(getImageAndFallback(req, res, next)).rejects.toThrow(/list image missing/)
    })

    it('falls back to unordered query when ordered fails', async () => {
      const img = makeImage()
      // First call (ordered) rejects with 404, second (unordered) succeeds
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      let callCount = 0
      const chainSuccess = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      const chainEmpty = makeDrizzleChain([])

      vi.mocked(getDrizzle).mockImplementation(() => {
        callCount++
        // First call returns empty (triggers NotFound), second returns data
        return (callCount === 1 ? chainEmpty : chainSuccess) as any
      })
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS, order: 'someorder' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageAndFallback(req, res, next)

      // Should have found an image on the second attempt
      expect(res.send).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // tryMultiple handler
  // -----------------------------------------------------------------------
  describe('tryMultiple', () => {
    it('returns 404 when no images found', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        query: { i: [`1/${TEST_ADDRESS}`] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
    })

    it('tries network icon when address is missing', async () => {
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        query: { i: ['1'] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(res.send).toHaveBeenCalled()
    })

    it('handles single string i query param', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        query: { i: `1/${TEST_ADDRESS}` },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      // Single string i is wrapped into array internally, falls through to 404
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
    })

    it('rejects invalid order hex in tryMultiple', async () => {
      const req = mockRequest({
        // order part is present but not 64 chars
        query: { i: [`1/${TEST_ADDRESS}/short`] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 406 }))
    })

    it('serves image when address lookup succeeds', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        query: { i: [`1/${TEST_ADDRESS}`] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(res.send).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('returns early when maybeResize handles response for address lookup', async () => {
      const img = makeImage()
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([
        {
          provider: { key: 'test' },
          list: { listId: '1' },
          list_token: { tokenId: '1' },
          token: { networkId: 'eip155:1' },
          image: img,
        },
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const req = mockRequest({
        query: { i: [`1/${TEST_ADDRESS}`] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(res.send).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('returns early when maybeResize handles response for network icon', async () => {
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const req = mockRequest({
        query: { i: ['1'] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(res.send).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })

    it('skips to next item when network icon not found', async () => {
      // First item: network icon not found. Second item: also not found.
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        query: { i: ['999', '998'] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
    })

    it('handles empty i query param', async () => {
      const req = mockRequest({ query: {} })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
    })
  })

  // -----------------------------------------------------------------------
  // queryStringToList (extracted pure function)
  // -----------------------------------------------------------------------
  describe('queryStringToList', () => {
    it('returns empty array for falsy input', () => {
      expect(queryStringToList(undefined)).toEqual([])
      expect(queryStringToList('')).toEqual([])
    })

    it('splits comma-separated string', () => {
      expect(queryStringToList('pulsex,coingecko')).toEqual(['pulsex', 'coingecko'])
    })

    it('filters empty segments from string', () => {
      expect(queryStringToList('pulsex,,coingecko,')).toEqual(['pulsex', 'coingecko'])
    })

    it('handles single string value', () => {
      expect(queryStringToList('pulsex')).toEqual(['pulsex'])
    })

    it('converts array values to strings', () => {
      expect(queryStringToList(['pulsex', 'coingecko'])).toEqual(['pulsex', 'coingecko'])
    })

    it('converts object via toString fallback', () => {
      const qs = { nested: 'value' } as any
      const result = queryStringToList(qs)
      expect(result).toEqual(['[object Object]'])
    })
  })

  // -----------------------------------------------------------------------
  // ignoreNotFound (extracted pure function)
  // -----------------------------------------------------------------------
  describe('ignoreNotFound', () => {
    it('returns null for 404 errors', () => {
      const err = { status: 404, message: 'Not Found' } as any
      expect(ignoreNotFound(err)).toBeNull()
    })

    it('re-throws non-404 errors', () => {
      const err = { status: 500, message: 'Server Error' } as any
      expect(() => ignoreNotFound(err)).toThrow()
    })

    it('re-throws 403 errors', () => {
      const err = { status: 403, message: 'Forbidden' } as any
      expect(() => ignoreNotFound(err)).toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // validateOutputFormat (extracted pure function)
  // -----------------------------------------------------------------------
  describe('validateOutputFormat', () => {
    it('returns null for valid raster-to-raster conversions', () => {
      expect(validateOutputFormat('.png', '.webp')).toBeNull()
      expect(validateOutputFormat('.jpg', '.png')).toBeNull()
      expect(validateOutputFormat('.webp', '.avif')).toBeNull()
    })

    it('returns null for svg-to-svg', () => {
      expect(validateOutputFormat('.svg', '.svg')).toBeNull()
      expect(validateOutputFormat('.svg+xml', '.svg')).toBeNull()
    })

    it('returns null for svg-to-raster', () => {
      expect(validateOutputFormat('.svg', '.png')).toBeNull()
      expect(validateOutputFormat('.svg', '.webp')).toBeNull()
    })

    it('returns error for raster-to-svg request', () => {
      const result = validateOutputFormat('.png', '.svg')
      expect(result).toBe('no SVG available for this token')
    })

    it('returns error for unsupported output format', () => {
      const result = validateOutputFormat('.png', '.bmp')
      expect(result).toContain('unsupported output format')
    })

    it('returns error for tiff output', () => {
      expect(validateOutputFormat('.png', '.tiff')).toContain('unsupported')
    })
  })

  // -----------------------------------------------------------------------
  // classifyImageServe (extracted pure function)
  // -----------------------------------------------------------------------
  describe('classifyImageServe', () => {
    it('returns serve for normal image with content', () => {
      const img = { ext: '.png', content: Buffer.from('x'.repeat(300)), uri: 'https://example.com/img.png' }
      expect(classifyImageServe(img, 'save')).toBe('serve')
    })

    it('returns redirect for LINK mode with http URI', () => {
      const img = { ext: '.png', content: Buffer.from('x'.repeat(300)), uri: 'https://example.com/img.png' }
      expect(classifyImageServe(img, 'link')).toBe('redirect')
    })

    it('returns redirect when content is empty and URI exists', () => {
      const img = { ext: '.png', content: Buffer.from(''), uri: 'https://example.com/img.png' }
      expect(classifyImageServe(img, 'save')).toBe('redirect')
    })

    it('returns redirect when raster content is tiny (< MIN_SERVABLE_RASTER_SIZE)', () => {
      const img = { ext: '.png', content: Buffer.from('x'.repeat(50)), uri: 'https://example.com/img.png' }
      expect(classifyImageServe(img, 'save')).toBe('redirect')
    })

    it('returns serve for tiny SVG (SVGs are not subject to size filter)', () => {
      const img = { ext: '.svg', content: Buffer.from('<svg/>'), uri: 'https://example.com/img.svg' }
      expect(classifyImageServe(img, 'save')).toBe('serve')
    })

    it('returns unavailable when no content and no http URI', () => {
      const img = { ext: '.png', content: null, uri: null }
      expect(classifyImageServe(img, 'save')).toBe('unavailable')
    })

    it('returns unavailable when tiny raster and no redirect URI', () => {
      const img = { ext: '.png', content: Buffer.from('x'), uri: 'data:image/png;base64,abc' }
      expect(classifyImageServe(img, 'save')).toBe('unavailable')
    })

    it('returns serve for content at exact MIN_SERVABLE_RASTER_SIZE threshold', () => {
      const img = {
        ext: '.png',
        content: Buffer.from('x'.repeat(MIN_SERVABLE_RASTER_SIZE)),
        uri: 'https://example.com/img.png',
      }
      expect(classifyImageServe(img, 'save')).toBe('serve')
    })
  })

  // -----------------------------------------------------------------------
  // parseTypeFilter (extracted pure function)
  // -----------------------------------------------------------------------
  describe('parseTypeFilter', () => {
    it('returns undefined for falsy input', () => {
      expect(parseTypeFilter(undefined)).toBeUndefined()
      expect(parseTypeFilter('')).toBeUndefined()
    })

    it('returns extension list for known format', () => {
      expect(parseTypeFilter('vector')).toEqual(['.svg', '.svg+xml', '.xml'])
      expect(parseTypeFilter('png')).toEqual(['.png'])
      expect(parseTypeFilter('webp')).toEqual(['.webp'])
    })

    it('is case-insensitive', () => {
      expect(parseTypeFilter('SVG')).toEqual(['.svg', '.svg+xml'])
      expect(parseTypeFilter('PNG')).toEqual(['.png'])
    })

    it('returns undefined for unknown format', () => {
      expect(parseTypeFilter('bmp')).toBeUndefined()
      expect(parseTypeFilter('tiff')).toBeUndefined()
    })

    it('returns undefined for non-string query (array/object)', () => {
      expect(parseTypeFilter(['vector', 'png'])).toBeUndefined()
      expect(parseTypeFilter({ nested: 'value' } as any)).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // getImage — bad chainId path
  // -----------------------------------------------------------------------
  describe('getImage bad chainId', () => {
    it('accepts chainId=0 (asset-0 namespace)', async () => {
      vi.mocked(db.applyOrder).mockResolvedValue([makeImage()])
      vi.mocked(getDefaultListOrderId).mockReturnValue('0xdefault' as const)
      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '0', address: TEST_ADDRESS },
        query: {},
      })
      const res = mockResponse()

      // Should not throw — chainId=0 is valid (asset-0)
      await handler(req, res, vi.fn())
    })

    it('accepts CAIP-2 chainId format', async () => {
      vi.mocked(db.applyOrder).mockResolvedValue([makeImage()])
      vi.mocked(getDefaultListOrderId).mockReturnValue('0xdefault' as const)
      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: 'eip155-369', address: TEST_ADDRESS },
        query: {},
      })
      const res = mockResponse()

      // Should not throw — CAIP-2 format is valid
      await handler(req, res, vi.fn())
    })
  })
})
