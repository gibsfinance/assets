/**
 * End-to-end regression tests for path-extension format conversion, run
 * through a REAL Express 5 app (supertest) with the REAL resize pipeline and
 * REAL sharp.
 *
 * Why a real app: the original bug was invisible to unit tests with plain
 * mock query objects — handlers mutated `req.query`, which works on a plain
 * object but is silently discarded by Express 5's non-memoized query getter.
 * Only a real request through Express exercises that behavior.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

vi.mock('../../db/tables', () => ({
  imageMode: { SAVE: 'save', LINK: 'link' },
}))
vi.mock('../../db', () => ({
  applyOrder: vi.fn(),
  getListOrderId: vi.fn(),
  getVariant: vi.fn(),
  bumpVariantAccess: vi.fn(),
  insertVariant: vi.fn(),
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
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import express from 'express'
import request from 'supertest'
import sharp from 'sharp'
import { getImage, getImageAndFallback, getImageByHash } from './handlers'
import { nextOnError } from '../utils'
import { IMAGE_CONTENT_SECURITY_POLICY } from './headers'
import { errorMiddleware } from '../middleware'
import * as db from '../../db'
import { getDrizzle } from '../../db/drizzle'
import { getDefaultListOrderId } from '../../db/sync-order'

const TEST_ADDRESS = '0x0000000000000000000000000000000000000001' as const

/** Build a chainable drizzle query builder mock resolving at `.limit()` */
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

/** A poorly-compressible real PNG so the raster passes the minimum-size serve check */
async function makeNoisePng(): Promise<Buffer> {
  const raw = Buffer.alloc(32 * 32 * 4)
  for (let i = 0; i < raw.length; i++) {
    raw[i] = (i * 2654435761) % 256
  }
  return sharp(raw, { raw: { width: 32, height: 32, channels: 4 } })
    .png()
    .toBuffer()
}

function buildApp() {
  const app = express()
  app.get('/image/direct/:imageHash', nextOnError(getImageByHash))
  app.get('/image/fallback/:order/:chainId/:address', nextOnError(getImageAndFallback))
  app.get('/image/:chainId/:address', nextOnError(getImage(false)))
  app.get('/api/json', (_req, res) => {
    res.json({ ok: true })
  })
  app.use(errorMiddleware)
  return app
}

describe('image handlers through a real Express 5 app', () => {
  let pngContent: Buffer
  let app: ReturnType<typeof buildApp>

  beforeAll(async () => {
    pngContent = await makeNoisePng()
    app = buildApp()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDefaultListOrderId).mockReturnValue(null)
    vi.mocked(db.getListOrderId).mockResolvedValue(null as never)
    vi.mocked(db.getVariant).mockResolvedValue(undefined as never)
    vi.mocked(db.bumpVariantAccess).mockResolvedValue(undefined as never)
    vi.mocked(db.insertVariant).mockResolvedValue(undefined as never)

    const row = {
      provider: { key: 'test' },
      list: { listId: '1' },
      list_token: { tokenId: '1' },
      token: { networkId: 'eip155:1' },
      image: {
        imageHash: 'hash-' + Math.random().toString(36).slice(2),
        content: pngContent,
        uri: 'https://example.com/token.png',
        ext: '.png',
        mode: 'save',
      },
    }
    vi.mocked(getDrizzle).mockImplementation(() => makeDrizzleChain([row]) as never)
  })

  it('serves the original png when no conversion is requested (control)', async () => {
    const res = await request(app).get(`/image/1/${TEST_ADDRESS}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.headers['x-resize']).toBe('original')
  })

  it('transcodes via path extension .webp (regression: req.query mutation was a no-op)', async () => {
    const res = await request(app).get(`/image/1/${TEST_ADDRESS}.webp`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/webp')
    expect(res.headers['x-resize']).toBe('transcoded')
  })

  it('path extension .webp is equivalent to ?as=webp', async () => {
    const viaExtension = await request(app).get(`/image/1/${TEST_ADDRESS}.webp`)
    const viaQuery = await request(app).get(`/image/1/${TEST_ADDRESS}?as=webp`)
    expect(viaExtension.status).toBe(200)
    expect(viaQuery.status).toBe(200)
    expect(viaExtension.headers['content-type']).toBe(viaQuery.headers['content-type'])
    expect(viaExtension.headers['content-length']).toBe(viaQuery.headers['content-length'])
    expect(viaExtension.headers['x-resize']).toBe(viaQuery.headers['x-resize'])
  })

  it('transcodes via path extension on the fallback route (regression: wrote the wrong query key)', async () => {
    const res = await request(app).get(`/image/fallback/default/1/${TEST_ADDRESS}.webp`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/webp')
    expect(res.headers['x-resize']).toBe('transcoded')
  })

  it('serves a bare hash on the direct route (regression: extensionless hash built invalid SQL)', async () => {
    const img = {
      imageHash: 'a'.repeat(64),
      content: pngContent,
      uri: 'https://example.com/token.png',
      ext: '.png',
      mode: 'save',
    }
    vi.mocked(getDrizzle).mockImplementation(() => makeDrizzleChain([img]) as never)

    const res = await request(app).get(`/image/direct/${'a'.repeat(64)}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })

  describe('plate parameters', () => {
    it('answers 400 for a bad bg on the token route and on the direct route', async () => {
      const token = await request(app).get(`/image/1/${TEST_ADDRESS}?bg=nope`)
      expect(token.status).toBe(400)
      expect(token.text).toContain('bg must be 3, 6 or 8 hex digits')
      const direct = await request(app).get(`/image/direct/${'a'.repeat(64)}?contrast=sideways`)
      expect(direct.status).toBe(400)
    })

    it('serves a plated image that differs from the plain one, with its own ETag', async () => {
      const plain = await request(app).get(`/image/1/${TEST_ADDRESS}`)
      const plated = await request(app).get(`/image/1/${TEST_ADDRESS}?bg=ff0000&shape=square`)
      expect(plated.status).toBe(200)
      expect(plated.headers['content-type']).toContain('image/png')
      expect(plated.headers.etag).toBeDefined()
      expect(plated.headers.etag).not.toBe(plain.headers.etag)
      expect(db.insertVariant).not.toHaveBeenCalled()
    })

    it('leaves the image unchanged when contrast finds no need for a plate', async () => {
      const res = await request(app).get(`/image/1/${TEST_ADDRESS}?contrast=dark`)
      expect(res.status).toBe(200)
      expect(res.headers['x-resize']).toBe('original')
    })
  })
  describe('security headers on image bytes', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#123456"/></svg>',
    )
    const expectLocked = (res: request.Response) => {
      expect(res.headers['content-security-policy']).toBe(IMAGE_CONTENT_SECURITY_POLICY)
      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
      )
      expect(res.headers['x-content-type-options']).toBe('nosniff')
    }
    const serveSvg = () =>
      vi.mocked(getDrizzle).mockImplementation(
        () =>
          makeDrizzleChain([
            {
              provider: { key: 'test' },
              list: { listId: '1' },
              list_token: { tokenId: '1' },
              token: { networkId: 'eip155:1' },
              image: {
                imageHash: 'b'.repeat(64),
                content: svg,
                uri: 'https://example.com/a.svg',
                ext: '.svg',
                mode: 'save',
              },
            },
          ]) as never,
      )

    it('are on the original', async () => {
      expectLocked(await request(app).get(`/image/1/${TEST_ADDRESS}`))
    })
    it('are on a vector served directly, the case the policy exists for', async () => {
      serveSvg()
      const res = await request(app).get(`/image/1/${TEST_ADDRESS}`)
      expect(res.headers['content-type']).toContain('image/svg+xml')
      expectLocked(res)
    })
    it('are on a converted variant, a stored variant and a plated image', async () => {
      expectLocked(await request(app).get(`/image/1/${TEST_ADDRESS}.webp`))
      vi.mocked(db.getVariant).mockResolvedValue({
        imageHash: 'x',
        width: 8,
        height: 8,
        format: 'png',
        content: pngContent,
      } as never)
      expectLocked(await request(app).get(`/image/1/${TEST_ADDRESS}?w=8`))
      expectLocked(await request(app).get(`/image/1/${TEST_ADDRESS}?bg=ff0000`))
    })
    it('are on a plated vector, which stays an svg', async () => {
      serveSvg()
      const res = await request(app).get(`/image/1/${TEST_ADDRESS}?bg=ff0000`)
      expect(res.headers['content-type']).toContain('image/svg+xml')
      expectLocked(res)
    })
    it('are on the content-addressed route, plain and plated', async () => {
      vi.mocked(getDrizzle).mockImplementation(
        () =>
          makeDrizzleChain([
            { imageHash: 'b'.repeat(64), content: svg, uri: 'https://example.com/a.svg', ext: '.svg', mode: 'save' },
          ]) as never,
      )
      expectLocked(await request(app).get(`/image/direct/${'b'.repeat(64)}`))
      expectLocked(await request(app).get(`/image/direct/${'b'.repeat(64)}?bg=00ff00`))
    })
    it('are on the fallback route', async () => {
      expectLocked(await request(app).get(`/image/fallback/default/1/${TEST_ADDRESS}`))
    })
    it('are absent from a JSON answer and from an error answer', async () => {
      for (const res of [
        await request(app).get('/api/json'),
        await request(app).get(`/image/1/${TEST_ADDRESS}?bg=nope`),
      ]) {
        expect(res.headers['content-type']).toContain('application/json')
        expect(res.headers['content-security-policy']).toBeUndefined()
        expect(res.headers['x-content-type-options']).toBeUndefined()
      }
    })
  })

  describe('a plated image on the content-addressed route', () => {
    it('is mutable, though a plain image there is immutable for a year', async () => {
      const hash = 'c'.repeat(64)
      vi.mocked(getDrizzle).mockImplementation(
        () =>
          makeDrizzleChain([
            { imageHash: hash, content: pngContent, uri: 'https://example.com/t.png', ext: '.png', mode: 'save' },
          ]) as never,
      )
      const plain = await request(app).get(`/image/direct/${hash}`)
      const plated = await request(app).get(`/image/direct/${hash}?bg=ff0000`)
      expect(plain.headers['cache-control']).toContain('immutable')
      expect(plated.headers['cache-control']).not.toContain('immutable')
      expect(plated.headers['cache-control']).toContain('max-age=86400')
    })
  })

  describe('a jpg through the real app', () => {
    it('is image/jpeg when resized and when plated', async () => {
      const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } })
        .jpeg()
        .toBuffer()
      vi.mocked(getDrizzle).mockImplementation(
        () =>
          makeDrizzleChain([
            {
              provider: { key: 'test' },
              list: { listId: '1' },
              list_token: { tokenId: '1' },
              token: { networkId: 'eip155:1' },
              image: {
                imageHash: 'j'.repeat(64),
                content: jpg,
                uri: 'https://example.com/t.jpg',
                ext: '.jpg',
                mode: 'save',
              },
            },
          ]) as never,
      )
      expect((await request(app).get(`/image/1/${TEST_ADDRESS}?w=32`)).headers['content-type']).toContain('image/jpeg')
      expect((await request(app).get(`/image/1/${TEST_ADDRESS}?bg=ff0000`)).headers['content-type']).toContain(
        'image/jpeg',
      )
    })
  })
})
