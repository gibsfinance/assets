import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock heavy transitive dependencies before importing handlers
vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', () => ({
  applyOrder: vi.fn(),
  getListOrderId: vi.fn(),
  getChainIdsByReference: vi.fn(async () => []),
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
// Keep the real parseResizeParams (handlers call it to build explicit options)
// but stub the resize pipeline itself.
vi.mock('./resize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./resize')>()),
  maybeResize: vi.fn(),
}))
vi.mock('sharp', () => ({ default: vi.fn() }))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import {
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
  isValidTokenAddress,
  RESOLVED_CHAIN_HEADER,
} from './handlers'
import type { Image } from '../../db/schema-types'
import * as db from '../../db'
import * as utils from '../../utils'
import { inArray, and } from 'drizzle-orm'
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
    // A bare-numeric network-icon lookup resolves the number against the stored
    // networks; default to "no other namespace holds it" so tests that do not care
    // about resolution keep meaning eip155. Reset explicitly because mockResolvedValue
    // implementations survive clearAllMocks and would otherwise leak between tests.
    vi.mocked(db.getChainIdsByReference).mockReset().mockResolvedValue([])
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

    // -----------------------------------------------------------------------
    // The entry's precomputed effective licence (list_token.license), when the
    // route joined one, must reach attributionHeaders — this is what lets a
    // known list_token report its OWN verified licence instead of falling back
    // to guessing from providerKey/uri alone.
    // -----------------------------------------------------------------------
    it("reports the list_token's precomputed effective licence, not a guess from providerKey alone", () => {
      const res = mockResponse()
      const img = {
        ...makeImage({ uri: 'https://cdn.unrelated-host.example/logo.png' }),
        providerKey: 'ethereum-lists',
        // The row's own computed licence — real production data, since this
        // address was never verified as ethereum-lists' own artwork.
        license: null,
      }

      sendImage(res, img, 'save')

      expect(res.set).toHaveBeenCalledWith('x-license', 'unknown')
    })

    it("carries the list's own licence url/attribution through when the entry licence matches it", () => {
      const res = mockResponse()
      const img = {
        ...makeImage({ uri: 'https://cdn.unrelated-host.example/logo.png' }),
        providerKey: 'some-provider',
        license: 'Apache-2.0',
        listLicense: 'Apache-2.0',
        listLicenseUrl: 'https://example.test/apache',
        listAttribution: 'Example Corp',
      }

      sendImage(res, img, 'save')

      expect(res.set).toHaveBeenCalledWith('x-license', 'Apache-2.0')
      expect(res.set).toHaveBeenCalledWith('x-license-url', 'https://example.test/apache')
      expect(res.set).toHaveBeenCalledWith('x-attribution', 'Example Corp')
    })

    // -----------------------------------------------------------------------
    // Immutable caching for content-addressed responses. `cachePolicy` is the
    // fourth, optional argument — every other call site in this file omits it
    // and must keep getting the ordinary, mutable-address cache lifetime.
    // -----------------------------------------------------------------------
    it('defaults to the ordinary max-age when cachePolicy is omitted', () => {
      const res = mockResponse()
      sendImage(res, makeImage(), 'save')
      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
    })

    it('serves the year-long, immutable cache-control when cachePolicy is content-addressed', () => {
      const res = mockResponse()
      sendImage(res, makeImage(), 'save', 'content-addressed')
      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=31536000, immutable')
    })

    // -----------------------------------------------------------------------
    // SVG root-element dimension stripping. A fixed width/height on the root
    // <svg> only forces cascading-style-sheet consumers to override it once a
    // viewBox already lets the browser scale the image — see
    // stripRootSvgDimensions in resize.ts, exercised here through the real
    // send path rather than mocked, since this is exactly the behavior a
    // caller of GET /image/{chainId} observes in the response body.
    // -----------------------------------------------------------------------
    it('strips width and height from a served SVG that has a viewBox', () => {
      const res = mockResponse()
      const svg = Buffer.from('<svg width="32" height="32" viewBox="0 0 32 32"></svg>')
      const img = makeImage({ content: svg, ext: '.svg' })
      sendImage(res, img, 'save')

      const [sentContent] = (res.send as ReturnType<typeof vi.fn>).mock.calls[0]
      const sent = Buffer.isBuffer(sentContent) ? sentContent.toString('utf8') : String(sentContent)
      expect(sent).not.toMatch(/width=/)
      expect(sent).not.toMatch(/height=/)
      expect(sent).toContain('viewBox="0 0 32 32"')
    })

    it('leaves a served SVG without a viewBox untouched (stripping would collapse it)', () => {
      const res = mockResponse()
      const svg = Buffer.from('<svg width="32" height="32"></svg>')
      const img = makeImage({ content: svg, ext: '.svg' })
      sendImage(res, img, 'save')

      expect(res.send).toHaveBeenCalledWith(svg)
    })

    it('never touches raster content — stripping applies to SVG extensions only', () => {
      const res = mockResponse()
      const raster = Buffer.from('x'.repeat(300))
      const img = makeImage({ content: raster, ext: '.png' })
      sendImage(res, img, 'save')

      expect(res.send).toHaveBeenCalledWith(raster)
    })

    it('redirects when mode is LINK and uri is http', () => {
      const res = mockResponse()
      const img = makeImage()
      sendImage(res, img, 'link')

      expect(res.redirect).toHaveBeenCalledWith('https://example.com/token.png')
    })

    it('sends the licence and provenance headers with a redirect, not only with content', () => {
      // The terms page at /terms states plainly, in a table, that every image response
      // carries its own provenance. A redirect is an image response. It used to carry
      // none of these headers, which mattered little while redirects were rare - and
      // would have become a published falsehood the moment link-only storage made every
      // address on such a host a redirect. A caller being sent to a third-party host
      // needs the licence more than one receiving our own bytes, not less.
      const res = mockResponse()
      const img = makeImage()

      sendImage(res, img, 'link')

      const headerNames = vi.mocked(res.set).mock.calls.map(([name]) => name)
      expect(headerNames).toContain('link')
      expect(headerNames).toContain('x-license')
      expect(headerNames).toContain('x-source-uri')
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

    // -----------------------------------------------------------------------
    // Attribution — sendImage must carry licence/provenance headers built from
    // the shared attribution module, not just the bare x-uri alias.
    // -----------------------------------------------------------------------
    it('carries full attribution headers for a known MIT provider', () => {
      const res = mockResponse()
      const img = {
        ...makeImage({ uri: '/submodules/trustwallet/blockchains/ethereum/assets/0xabc/logo.png' }),
        providerKey: 'trustwallet',
      }
      sendImage(res, img, 'save')

      expect(res.set).toHaveBeenCalledWith('link', '<https://gib.show/terms>; rel="license"')
      expect(res.set).toHaveBeenCalledWith('x-provider', 'trustwallet')
      expect(res.set).toHaveBeenCalledWith('x-provider-name', 'Trust Wallet')
      expect(res.set).toHaveBeenCalledWith('x-license', 'MIT')
      expect(res.set).toHaveBeenCalledWith('x-license-url', 'https://github.com/trustwallet/assets/blob/master/LICENSE')
      expect(res.set).toHaveBeenCalledWith('x-attribution', 'Copyright (c) 2019-2023 Trust Wallet - MIT')
      // x-uri stays a backwards-compatible alias for x-source-uri.
      expect(res.set).toHaveBeenCalledWith('x-source-uri', 'trustwallet/blockchains/ethereum/assets/0xabc/logo.png')
      expect(res.set).toHaveBeenCalledWith('x-uri', 'trustwallet/blockchains/ethereum/assets/0xabc/logo.png')
    })

    it('omits x-provider/x-provider-name/x-license-url for an unresolvable source', () => {
      const res = mockResponse()
      const img = makeImage({ uri: 'https://cdn.unknown-host.example/icon.png' })
      sendImage(res, img, 'save')

      const setCalls = (res.set as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
      expect(setCalls).not.toContain('x-provider')
      expect(setCalls).not.toContain('x-provider-name')
      expect(setCalls).not.toContain('x-license-url')
      expect(res.set).toHaveBeenCalledWith('x-license', 'unknown')
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

    // -------------------------------------------------------------------
    // Regression: `provider` and `list` both carry `key` and `name` columns,
    // so a plain object spread of `{ ...provider, ...list, ... }` — spreading
    // `list` after `provider` — overwrites the provider's key with the list's.
    // `img.key` on the unordered path therefore names the LIST, never the
    // provider, and anything that trusted it for provider identity was
    // silently reading the wrong value. The provider key must survive the
    // spread under its own name (`providerKey`), the same alias applyOrder's
    // SQL already uses on the ordered path.
    // -------------------------------------------------------------------
    it('reports the provider key, not the list key, when the two differ', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      const fakeRow = {
        provider: { key: 'trustwallet', name: 'Trust Wallet' },
        list: { listId: '1', key: 'tokens-1', name: 'Ethereum tokens' },
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

      // The bug this guards against: img.key silently became 'tokens-1' (the
      // list key) because the list spread landed after the provider spread.
      expect(result.img?.key).toBe('tokens-1')
      // The fix: providerKey is carried under its own name and survives the
      // spread untouched, so callers needing provider identity read this
      // instead of the overwritten `key`.
      expect((result.img as unknown as { providerKey?: string })?.providerKey).toBe('trustwallet')
    })

    // Companion to the test above: `list` and `list_token` both carry a
    // `license` column too, and the SAME spread collision leaves the list's
    // own registered licence unreachable under its own name unless it is read
    // out separately — exactly like providerKey.
    it("carries the list's own licence/url/attribution under distinguishing names, on the unordered path", async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)

      const fakeRow = {
        provider: { key: 'trustwallet' },
        list: { listId: '1', license: 'MIT', licenseUrl: 'https://example.test/license', attribution: 'Corp' },
        list_token: { tokenId: '1', license: 'MIT' },
        token: { networkId: 'eip155:1' },
        image: makeImage(),
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getListTokens({ chainId: 1, address: TEST_ADDRESS })

      const img = result.img as unknown as {
        license?: string
        listLicense?: string
        listLicenseUrl?: string
        listAttribution?: string
      }
      // The entry's own effective licence — from list_token, spread last, so it
      // wins the collision.
      expect(img.license).toBe('MIT')
      // The list's own registered fields, under their own names, never lost.
      expect(img.listLicense).toBe('MIT')
      expect(img.listLicenseUrl).toBe('https://example.test/license')
      expect(img.listAttribution).toBe('Corp')
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

    // -------------------------------------------------------------------
    // The opt-in ?license= filter. It has to land in the SAME conditions array
    // as providerKey/listKey — the funnel applyOrder's WHERE clause reads —
    // because that is what makes it narrow candidates BEFORE the dense_rank
    // window function inside the same CTE picks a winner, rather than being
    // applied to whatever that ranking already chose.
    // -------------------------------------------------------------------
    it('adds a case-insensitive licence condition only when the license filter is given', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue('0xdefault' as const)
      vi.mocked(db.applyOrder).mockResolvedValue([makeImage()])
      vi.mocked(inArray).mockClear()

      await getListTokens({
        chainId: 1,
        address: TEST_ADDRESS,
        license: ['MIT', 'Apache-2.0'],
      })

      // Lowercased in JS before ever reaching SQL — the column side is folded
      // with lower() in the actual (unmocked) query, so both sides agree. The
      // mocked `sql` tag has no implementation and returns undefined, which is
      // fine here — this test is about the array being case-folded and reaching
      // inArray, not about the SQL text (drizzle-orm itself is mocked in this file).
      expect(inArray).toHaveBeenCalledWith(undefined, ['mit', 'apache-2.0'])
      // `and(...conditions)` is called with each condition as its own argument
      // — reading `and`'s own recorded call args (not casting applyOrder's real
      // SQL-typed parameter) is what proves the licence inArray's return value
      // is one of the SAME conditions providerKey/listKey already combine into,
      // not a separate, later filter.
      const andConditions = vi.mocked(and).mock.calls[0]
      expect(andConditions).toContainEqual(vi.mocked(inArray).mock.results[0]!.value)
    })

    it('omits the licence condition entirely when no license filter is given', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue('0xdefault' as const)
      vi.mocked(db.applyOrder).mockResolvedValue([makeImage()])
      vi.mocked(inArray).mockClear()

      await getListTokens({ chainId: 1, address: TEST_ADDRESS })

      expect(inArray).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------
  // getImage with ?license= — the caller-visible half of the filter. The
  // filter itself lives inside the WHERE clause (proved above and in
  // db/index.order.test.ts), so from a caller's side this is really a test
  // of what happens once the database has already excluded every candidate:
  // the ordinary not-found for this route, never a served-but-unlicensed image.
  // -------------------------------------------------------------------
  describe('getImage with a license filter', () => {
    it('answers the ordinary not-found when the licence filter excludes every candidate', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      // Standing in for "the WHERE clause's licence predicate matched nothing":
      // an empty result reads identically whether providerKey, listKey, or
      // license excluded the only candidate — there is no separate "found an
      // image but it was unlicensed" path to fall into.
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS },
        query: { license: 'MIT' },
      })
      const res = mockResponse()

      await expect(handler(req, res, vi.fn())).rejects.toThrow(/list image missing/)
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

    it('carries the collector that supplied the icon, so attribution can name it', async () => {
      // The network row stores it as imageProviderKey; everything downstream reads
      // providerKey. Without the rename a network icon reached attribution with no
      // provider at all, and served its licence as unknown once its address stopped
      // naming its source.
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1', imageProviderKey: 'smoldapp' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const result = await getNetworkIcon(1)

      expect((result.img as { providerKey?: string }).providerKey).toBe('smoldapp')
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

    // -------------------------------------------------------------------
    // Guard against a future refactor leaking the year-long, immutable
    // cache-control (added for /image/direct/{imageHash}, a content-addressed
    // route) onto this mutable-address route — a token can get a new image
    // at the same chainId/address later, so this route must keep the
    // ordinary, configured lifetime.
    // -------------------------------------------------------------------
    it('serves the ordinary configured max-age, never the immutable content-addressed cache-control', async () => {
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

      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
      expect(res.set).not.toHaveBeenCalledWith('cache-control', 'public, max-age=31536000, immutable')
    })

    it('passes the path-extension format to maybeResize without mutating req.query', async () => {
      // Regression: the handler used to write `req.query.as = 'webp'`, but
      // Express 5 re-parses query on every access, so the mutation was
      // discarded and path-extension conversion was a silent no-op.
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

      expect(req.query.as).toBeUndefined()
      expect(maybeResize).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ format: 'webp' }) }),
      )
    })

    it('lets an explicit query.as win over the path extension', async () => {
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

      expect(maybeResize).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ format: 'png' }) }),
      )
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

    it('rejects a base58 address on an explicit Ethereum-Virtual-Machine chain', async () => {
      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: 'eip155-1', address: 'So11111111111111111111111111111111111111112' },
        query: {},
      })
      await expect(handler(req, mockResponse(), vi.fn())).rejects.toThrow(/address/)
    })

    // Deliberate trade-off. This case used to reject, which also rejected every
    // base58 address on a BARE id — and /image/501/<mint> is a bare id for Solana,
    // so valid requests 400'd. A bare number names no namespace, so the shape check
    // cannot rule either out; the lookup below still refuses to serve a token that
    // does not exist, turning this into a 404 rather than a 400.
    it('does not reject a base58 address on a bare chain id', async () => {
      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '1', address: 'So11111111111111111111111111111111111111112' },
        query: {},
      })
      await expect(handler(req, mockResponse(), vi.fn())).resolves.not.toThrow()
    })
  })

  describe('isValidTokenAddress', () => {
    const evmAddress = '0x0000000000000000000000000000000000000001'
    const solanaMint = 'So11111111111111111111111111111111111111112'
    const tronAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

    it('requires a hex address for Ethereum-Virtual-Machine chains', () => {
      expect(isValidTokenAddress(1, evmAddress)).toBe(true)
      expect(isValidTokenAddress('eip155-1', evmAddress)).toBe(true)
      expect(isValidTokenAddress(0, evmAddress)).toBe(true) // asset-0 is Ethereum-Virtual-Machine hex
      expect(isValidTokenAddress('eip155-1', solanaMint)).toBe(false) // base58 rejected on an explicit eip155 chain
    })

    it('accepts a bounded token identifier for non-Ethereum-Virtual-Machine chains', () => {
      expect(isValidTokenAddress('solana-501', solanaMint)).toBe(true)
      expect(isValidTokenAddress('tvm-195', tronAddress)).toBe(true)
      expect(isValidTokenAddress('solana-501', '')).toBe(false) // empty
      expect(isValidTokenAddress('solana-501', 'a'.repeat(200))).toBe(false) // over-length garbage
    })

    // A bare number names no namespace. This previously assumed eip155 and rejected
    // every base58 address reachable through a bare id — and /stats publishes exactly
    // those bare ids, so /image/501/<mint> 400'd on a mint that /image/solana-501/
    // serves happily. Both shapes are accepted when the namespace is unstated.
    it('accepts either address shape when the namespace is unstated', () => {
      expect(isValidTokenAddress(501, solanaMint)).toBe(true)
      expect(isValidTokenAddress(195, tronAddress)).toBe(true)
      expect(isValidTokenAddress(1, evmAddress)).toBe(true)
    })

    // The deliberate trade-off: a wrong-shaped address on a bare id is no longer a
    // 400. The database lookup still refuses to serve it, so the caller gets a 404 —
    // "no such token" rather than "malformed request". Garbage is still rejected
    // outright, which is what the bound is actually for.
    it('still rejects garbage on a bare id', () => {
      expect(isValidTokenAddress(1, '')).toBe(false)
      expect(isValidTokenAddress(1, 'a'.repeat(200))).toBe(false)
      expect(isValidTokenAddress(1, 'not an address')).toBe(false) // spaces
    })
  })

  // -----------------------------------------------------------------------
  // getImageByHash handler
  // -----------------------------------------------------------------------
  describe('getImageByHash', () => {
    it('refuses an image whose licence is not among those requested', async () => {
      // A hash names one set of bytes, so there is nothing else to offer. Serving it
      // anyway would break the filter's one promise: never an image outside the
      // licences the caller asked for.
      const chain = makeDrizzleChain([makeImage({ uri: 'https://static.debank.com/image/x/0xabc/1d03.png' })])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      const req = mockRequest({ params: { imageHash: 'abc123' }, query: { license: 'MIT' } })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }))
      expect(res.send).not.toHaveBeenCalled()
    })

    it('serves an image whose licence is among those requested, matched without regard to case', async () => {
      const chain = makeDrizzleChain([
        makeImage({ uri: 'https://raw.githubusercontent.com/SmolDapp/tokenAssets/21d8743b/chains/1/logo.svg' }),
      ])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)
      const req = mockRequest({ params: { imageHash: 'abc123' }, query: { license: ['apache-2.0', 'mit'] } })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.send).toHaveBeenCalled()
    })

    it('serves image found by hash with an extension filter', async () => {
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
      // hash.png keeps source-extension filtering
      expect(inArray).toHaveBeenCalledWith(expect.anything(), ['.png'])
    })

    it('serves a bare hash without building an extension filter', async () => {
      // Regression: the documented bare-hash form passed `exts: undefined`
      // into inArray, producing invalid SQL — a 500 that leaked the query.
      const img = makeImage()
      const chain = makeDrizzleChain([img])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({
        params: { imageHash: 'abc123' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      expect(inArray).not.toHaveBeenCalled()
      expect(res.contentType).toHaveBeenCalledWith('.png')
      expect(res.send).toHaveBeenCalled()
    })

    // -------------------------------------------------------------------
    // This route addresses an image by the hash of its own bytes, so the
    // response at this address can never change — it gets the year-long,
    // immutable cache-control instead of the ordinary configured lifetime,
    // on both the direct-serve path (this test) and any resized variant
    // (the next test, checking what getImageByHash asks maybeResize for).
    // -------------------------------------------------------------------
    it('serves the year-long, immutable cache-control, not the ordinary max-age', async () => {
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

      expect(res.set).toHaveBeenCalledWith('cache-control', 'public, max-age=31536000, immutable')
      expect(res.set).not.toHaveBeenCalledWith('cache-control', 'public, max-age=86400')
    })

    it('asks maybeResize for the content-addressed cache policy, so a resized variant is equally immutable', async () => {
      const img = makeImage()
      const chain = makeDrizzleChain([img])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const req = mockRequest({
        params: { imageHash: 'abc123.webp' },
        query: { as: 'webp' },
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      expect(maybeResize).toHaveBeenCalledWith(expect.objectContaining({ cachePolicy: 'content-addressed' }))
    })

    it('returns early without sending the original when maybeResize already served a variant', async () => {
      const img = makeImage()
      const chain = makeDrizzleChain([img])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const req = mockRequest({
        params: { imageHash: 'abc123.webp' },
        query: { as: 'webp' },
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageByHash(req, res, next)

      // sendImage must not also fire — that would double-write the response.
      expect(res.contentType).not.toHaveBeenCalled()
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
    it('refuses a network icon whose licence is not among those requested', async () => {
      // Found on staging: PulseChain's icon has no known licence, and
      // ?license=MIT served it anyway because this route never read the filter.
      const fakeRow = {
        image: makeImage({ uri: 'https://tokens.app.pulsex.com/images/tokens/0xabc.png' }),
        network: { networkId: 'eip155:369', imageProviderKey: 'pulsex' },
      }
      vi.mocked(getDrizzle).mockReturnValue(makeDrizzleChain([fakeRow]) as any)
      const req = mockRequest({ params: { chainId: '369' }, query: { license: 'MIT' } })
      const res = mockResponse()

      await expect(bestGuessNetworkImageFromOnOnChainInfo(req, res, vi.fn())).rejects.toMatchObject({ status: 404 })
      expect(res.send).not.toHaveBeenCalled()
    })

    it('serves a network icon whose own licence satisfies the request', async () => {
      const fakeRow = {
        image: makeImage({ uri: 'https://raw.githubusercontent.com/SmolDapp/tokenAssets/21d8743b/chains/1/logo.svg' }),
        network: { networkId: 'eip155:1', imageProviderKey: 'smoldapp' },
      }
      vi.mocked(getDrizzle).mockReturnValue(makeDrizzleChain([fakeRow]) as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)
      const req = mockRequest({ params: { chainId: '1' }, query: { license: 'MIT' } })
      const res = mockResponse()

      await bestGuessNetworkImageFromOnOnChainInfo(req, res, vi.fn())

      expect(res.send).toHaveBeenCalled()
    })

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

    // -------------------------------------------------------------------
    // A caller who gets a 200 from this route cannot otherwise tell an exact
    // match from a best guess — worse than a 404 for a page identifying a
    // chain to a user. The header must name what the request actually
    // resolved to, not merely echo the request back.
    // -------------------------------------------------------------------
    it('names the resolved chain identifier in x-resolved-chain, in prefixed form', async () => {
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({ params: { chainId: '1' }, query: {} })
      const res = mockResponse()

      await bestGuessNetworkImageFromOnOnChainInfo(req, res, vi.fn())

      expect(res.set).toHaveBeenCalledWith(RESOLVED_CHAIN_HEADER, 'eip155-1')
    })

    it('names the actually-resolved namespace, not the bare request, for a best-guess resolution', async () => {
      // Same scenario as "resolves a bare non-Ethereum-Virtual-Machine chain
      // number..." below: 354 is bare and resolves to polkadot-354. The
      // header must carry that resolved identifier, not the request's bare 354.
      vi.mocked(db.getChainIdsByReference).mockResolvedValue([{ chainId: 'polkadot-354', hasTokens: false }])
      const chain = makeDrizzleChain([{ image: makeImage(), network: { networkId: 'polkadot:354' } }])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({ params: { chainId: '354' }, query: {} })
      const res = mockResponse()

      await bestGuessNetworkImageFromOnOnChainInfo(req, res, vi.fn())

      expect(res.set).toHaveBeenCalledWith(RESOLVED_CHAIN_HEADER, 'polkadot-354')
    })

    it('does not set x-resolved-chain when resolution fails and no image is found', async () => {
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({ params: { chainId: '999' }, query: {} })
      const res = mockResponse()

      await expect(bestGuessNetworkImageFromOnOnChainInfo(req, res, vi.fn())).rejects.toThrow()

      expect(res.set).not.toHaveBeenCalledWith(RESOLVED_CHAIN_HEADER, expect.anything())
    })

    it('returns early without sending the original when maybeResize already served a variant', async () => {
      const fakeRow = {
        image: makeImage(),
        network: { networkId: 'eip155:1' },
      }
      const chain = makeDrizzleChain([fakeRow])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const req = mockRequest({
        params: { chainId: '1' },
        query: { as: 'webp' },
      })
      const res = mockResponse()
      const next = vi.fn()

      await bestGuessNetworkImageFromOnOnChainInfo(req, res, next)

      // sendImage must not also fire — that would double-write the response.
      expect(res.contentType).not.toHaveBeenCalled()
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

    it('resolves a bare non-Ethereum-Virtual-Machine chain number to its stored namespace before lookup', async () => {
      // /networks publishes polkadot-354 as the bare number 354 for backwards
      // compatibility. Feeding that number straight back to the icon endpoint assumed
      // eip155-354, matched no row, and answered 404 — while /networks kept advertising
      // the hash. Resolve the number the same way the token-list endpoints do, so both
      // paths name the same network instead of disagreeing.
      vi.mocked(db.getChainIdsByReference).mockResolvedValue([{ chainId: 'polkadot-354', hasTokens: false }])
      const chain = makeDrizzleChain([{ image: makeImage(), network: { networkId: 'polkadot:354' } }])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({ params: { chainId: '354' }, query: {} })
      const res = mockResponse()

      await bestGuessNetworkImageFromOnOnChainInfo(req, res, vi.fn())

      expect(db.getChainIdsByReference).toHaveBeenCalledWith('354')
      // The resolved identifier, not the bare number, is what reaches the lookup.
      expect(vi.mocked(utils.chainIdToNetworkId)).toHaveBeenCalledWith('polkadot-354')
      expect(res.send).toHaveBeenCalled()
    })

    it('keeps a bare number meaning eip155 when an Ethereum-Virtual-Machine network holds it', async () => {
      // The collision case: both eip155-2 and bip122-2 exist. A bare 2 must stay
      // Ethereum's chain, never silently switch to the Bitcoin-namespace network, exactly
      // as /list/tokens/2 does.
      vi.mocked(db.getChainIdsByReference).mockResolvedValue([
        { chainId: 'eip155-2', hasTokens: true },
        { chainId: 'bip122-2', hasTokens: true },
      ])
      const chain = makeDrizzleChain([{ image: makeImage(), network: { networkId: 'eip155:2' } }])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({ params: { chainId: '2' }, query: {} })

      await bestGuessNetworkImageFromOnOnChainInfo(req, mockResponse(), vi.fn())

      expect(vi.mocked(utils.chainIdToNetworkId)).toHaveBeenCalledWith('eip155-2')
    })

    it('rejects a genuinely ambiguous bare number instead of guessing a namespace', async () => {
      // Two populated non-Ethereum-Virtual-Machine namespaces and no eip155: serving one
      // chain's icon under the other's number would be a lie. A 400 tells the caller to
      // name the namespace explicitly.
      vi.mocked(db.getChainIdsByReference).mockResolvedValue([
        { chainId: 'bip122-7', hasTokens: true },
        { chainId: 'solana-7', hasTokens: true },
      ])

      const req = mockRequest({ params: { chainId: '7' }, query: {} })

      await expect(bestGuessNetworkImageFromOnOnChainInfo(req, mockResponse(), vi.fn())).rejects.toThrow(/ambiguous/)
    })

    it('passes an explicitly namespaced request through without a reference lookup', async () => {
      // polkadot-354 is already an assertion about namespace, so no resolution is needed
      // — and none should happen, or an explicit request would pay a query it does not use.
      const chain = makeDrizzleChain([{ image: makeImage(), network: { networkId: 'polkadot:354' } }])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)
      vi.mocked(maybeResize).mockResolvedValue(false as any)

      const req = mockRequest({ params: { chainId: 'polkadot-354' }, query: {} })

      await bestGuessNetworkImageFromOnOnChainInfo(req, mockResponse(), vi.fn())

      expect(db.getChainIdsByReference).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // getImageAndFallback handler
  // -----------------------------------------------------------------------
  describe('getImageAndFallback', () => {
    it('passes the path-extension format to maybeResize without mutating req.query', async () => {
      // Regression: this handler wrote `req.query.format` — both the wrong key
      // (resize reads `as`) and a discarded mutation under Express 5 — so the
      // fallback route never honored path-extension conversion.
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

      expect(req.query.format).toBeUndefined()
      expect(req.query.as).toBeUndefined()
      expect(maybeResize).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ format: 'webp' }) }),
      )
    })

    it('lets an explicit query.as win over the path extension', async () => {
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
        query: { as: 'png' },
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageAndFallback(req, res, next)

      expect(maybeResize).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ format: 'png' }) }),
      )
    })

    it('reports a not-found error when both ordered and unordered queries find nothing', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      const chain = makeDrizzleChain([])
      vi.mocked(getDrizzle).mockReturnValue(chain as any)

      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS, order: 'someorder' },
        query: {},
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageAndFallback(req, res, next)

      // A miss on both lookups is a 404, not an unhandled rejection. Both
      // lookups swallow not-found so the handler owns the response, matching
      // getImageByQuery — the sibling handler doing the same two-step lookup.
      const [error] = next.mock.calls[0] as [{ status: number }]
      expect(error.status).toBe(404)
      expect(res.send).not.toHaveBeenCalled()
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

    it('lets the resize pipeline own the response when it handles the request', async () => {
      vi.mocked(getDefaultListOrderId).mockReturnValue(null)
      vi.mocked(getDrizzle).mockReturnValue(
        makeDrizzleChain([
          {
            provider: { key: 'test' },
            list: { listId: '1' },
            list_token: { tokenId: '1' },
            token: { networkId: 'eip155:1' },
            image: makeImage(),
          },
        ]) as any,
      )
      // A satisfied resize has already written the response body; sending the
      // original image afterwards would append a second body to the same
      // response, so the handler has to stop here.
      vi.mocked(maybeResize).mockResolvedValue(true as any)

      const req = mockRequest({
        params: { chainId: '1', address: TEST_ADDRESS, order: 'someorder' },
        query: { as: 'webp' },
      })
      const res = mockResponse()
      const next = vi.fn()

      await getImageAndFallback(req, res, next)

      expect(res.send).not.toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
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

    // Every element the array-building step produces goes through `.toString()`,
    // so a genuinely non-string entry only reaches the loop when an array item's
    // own `.toString()` override defies its contract and returns a non-string —
    // the guard exists for exactly that malformed-input case.
    it('rejects a non-string entry surviving the array-building step', async () => {
      const malformed = { toString: () => 12345 }
      const req = mockRequest({
        query: { i: [malformed] as unknown as string[] },
      })
      const res = mockResponse()
      const next = vi.fn()

      await tryMultiple(req as any, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 406, message: 'invalid i' }))
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

    // Distinct from chainId=0 (asset-0, a valid namespace) — an entirely absent
    // chainId must fail fast rather than fall through to the address validator.
    it('rejects an empty chainId with 400 before validating the address', async () => {
      const handler = getImage(false)
      const req = mockRequest({
        params: { chainId: '', address: TEST_ADDRESS },
        query: {},
      })
      const res = mockResponse()

      await expect(handler(req, res, vi.fn())).rejects.toThrow(/chainId/)
      expect(db.applyOrder).not.toHaveBeenCalled()
    })
  })
})
