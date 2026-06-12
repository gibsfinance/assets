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
})
