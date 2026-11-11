/**
 * Header and body parity between the two places an image's bytes can live, through a REAL
 * Express 5 app with the REAL resize pipeline and the REAL local image store.
 *
 * The bytes of one image are in the `image` row before `images export` has run, and in a file
 * afterwards. Nothing a client can see may depend on which. Every route is requested in each
 * state, and the status, the body and every header must match the control that carries the
 * bytes in the row, byte for byte.
 */
import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({ default: { cacheSeconds: 86400, imageStoreDirectory: '' } }))

vi.mock('../../db/tables', () => ({ imageMode: { SAVE: 'save', LINK: 'link' } }))
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
vi.mock('../../utils', () => ({ chainIdToNetworkId: vi.fn((id: number) => `eip155:${id}`) }))
vi.mock('../../paths', () => ({ submodules: '/submodules' }))
vi.mock('../../types', () => ({}))
vi.mock('../../../config', () => configMock)
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  sql: Object.assign(vi.fn(), { join: vi.fn(), raw: vi.fn() }),
}))

import express from 'express'
import request from 'supertest'
import sharp from 'sharp'
import { bestGuessNetworkImageFromOnOnChainInfo, getImage, getImageByHash, tryMultiple } from './handlers'
import { nextOnError } from '../utils'
import * as db from '../../db'
import { getDrizzle } from '../../db/drizzle'
import { getDefaultListOrderId } from '../../db/sync-order'
import { getImageStore, resetImageStoreForTests, hashBytes } from '../../image-store'

const TEST_ADDRESS = '0x0000000000000000000000000000000000000001' as const
const HASH = 'b'.repeat(64)
const SOURCE_URI = 'https://example.com/token.png'

/** Headers that describe the response and must not depend on where the bytes were kept. */
const COMPARED_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'x-resize',
  'link',
  'x-license',
  'x-uri',
  'x-source-uri',
  'etag',
  'x-resolved-chain',
] as const

/** A poorly compressible PNG, big enough to pass the minimum servable size. */
const makeNoisePng = (): Promise<Buffer> => {
  const raw = Buffer.alloc(32 * 32 * 4)
  for (let index = 0; index < raw.length; index++) raw[index] = (index * 2654435761) % 256
  return sharp(raw, { raw: { width: 32, height: 32, channels: 4 } })
    .png()
    .toBuffer()
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/></svg>',
)

/** A drizzle chain that resolves to `rows` at `.limit()`. */
const chainOf = (rows: unknown[]) => {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'leftJoin', 'rightJoin', 'where']) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.limit = vi.fn().mockResolvedValue(rows)
  return chain
}

/** The columns of an image row that say where its bytes are, in the state a query leaves them in. */
type ImageState = { content: Buffer | null; contentSha256: string | null; byteSize: number | null }

const buildApp = () => {
  const app = express()
  app.get('/image/direct/:imageHash', nextOnError(getImageByHash))
  app.get('/image/multi', nextOnError(tryMultiple))
  app.get('/image/network/:chainId', nextOnError(bestGuessNetworkImageFromOnOnChainInfo))
  app.get('/image/:chainId/:address', nextOnError(getImage(false)))
  return app
}

/** One route, and how to make the mocked database answer it with a given image row. */
type Route = { name: string; url: string; answerWith: (image: Record<string, unknown>) => void }

const imageRow = (ext: string, state: ImageState) => ({
  imageHash: HASH,
  uri: SOURCE_URI,
  ext,
  mode: 'save',
  ...state,
})

/** Answers a token-image query: the joined row `getListTokens` flattens. */
const answerTokenImage = (image: Record<string, unknown>) =>
  vi
    .mocked(getDrizzle)
    .mockImplementation(
      () =>
        chainOf([
          { provider: { key: 'test' }, list: { listId: '1' }, list_token: { tokenId: '1' }, token: {}, image },
        ]) as never,
    )

const routes = (ext: string): Route[] => [
  { name: 'token image', url: `/image/1/${TEST_ADDRESS}`, answerWith: answerTokenImage },
  { name: 'multi', url: `/image/multi?i=1/${TEST_ADDRESS}`, answerWith: answerTokenImage },
  {
    name: 'network icon',
    url: `/image/network/eip155-1`,
    answerWith: (image) =>
      vi
        .mocked(getDrizzle)
        .mockImplementation(() => chainOf([{ image, network: { imageProviderKey: 'test' } }]) as never),
  },
  {
    name: `direct by hash (${ext})`,
    url: `/image/direct/${HASH}`,
    answerWith: (image) => vi.mocked(getDrizzle).mockImplementation(() => chainOf([image]) as never),
  },
]

describe.each([
  ['png', '.png'],
  ['svg', '.svg'],
])('image bytes from the row or the store: %s', (_label, ext) => {
  let storeRoot: string
  let bytes: Buffer
  let app: ReturnType<typeof buildApp>

  beforeAll(async () => {
    storeRoot = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-parity-'))
    configMock.default.imageStoreDirectory = storeRoot
    resetImageStoreForTests()
    bytes = ext === '.png' ? await makeNoisePng() : SVG
    app = buildApp()
  })

  afterAll(async () => {
    await fileSystem.rm(storeRoot, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDefaultListOrderId).mockReturnValue(null)
    vi.mocked(db.getListOrderId).mockResolvedValue(null as never)
    vi.mocked(db.getVariant).mockResolvedValue(undefined as never)
    vi.mocked(db.bumpVariantAccess).mockResolvedValue(undefined as never)
    vi.mocked(db.insertVariant).mockResolvedValue(undefined as never)
  })

  /** The states a row can be in, each describing the same bytes. */
  const states = (): Record<string, () => Promise<ImageState>> => ({
    'before the backfill: bytes in the row, no digest': async () => ({
      content: bytes,
      contentSha256: null,
      byteSize: null,
    }),
    'after the backfill, bytes still in the database: digest set, bytes narrowed away': async () => {
      const stored = await getImageStore().put(bytes)
      return { content: null, contentSha256: stored.sha256, byteSize: stored.byteSize }
    },
    'bytes no longer written to the database: digest set, content null': async () => {
      const stored = await getImageStore().put(bytes)
      return { content: null, contentSha256: stored.sha256, byteSize: bytes.length }
    },
  })

  describe.each(routes(ext).map((route) => [route.name, route] as const))('%s', (_name, route) => {
    const fetchWith = async (state: ImageState, extraHeaders: Record<string, string> = {}) => {
      route.answerWith(imageRow(ext, state))
      return request(app)
        .get(route.url)
        .set(extraHeaders)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => callback(null, Buffer.concat(chunks)))
        })
    }

    it('answers every state identically to the control that carries the bytes in the row', async () => {
      const control = await fetchWith({ content: bytes, contentSha256: null, byteSize: null })
      expect(control.status).toBe(200)
      expect(control.headers['etag']).toBeTruthy()
      expect(control.headers['x-license']).toBeTruthy()
      expect(control.headers['link']).toBeTruthy()

      for (const [label, makeState] of Object.entries(states())) {
        const response = await fetchWith(await makeState())
        expect(response.status, label).toBe(200)
        expect(Buffer.compare(response.body, control.body), `${label}: body`).toBe(0)
        for (const header of COMPARED_HEADERS) {
          expect(response.headers[header], `${label}: ${header}`).toBe(control.headers[header])
        }
      }
    })

    it('answers 304 to If-None-Match with the control etag in every state', async () => {
      const control = await fetchWith({ content: bytes, contentSha256: null, byteSize: null })
      const etag = control.headers['etag']

      for (const [label, makeState] of Object.entries(states())) {
        const response = await fetchWith(await makeState(), { 'if-none-match': etag })
        expect(response.status, label).toBe(304)
        expect(response.headers['etag'], label).toBe(etag)
      }
    })

    it('redirects to the source address when the file is missing, with the same attribution headers', async () => {
      const control = await fetchWith({ content: bytes, contentSha256: null, byteSize: null })
      const missing = hashBytes(Buffer.from(`never stored ${ext} ${route.name}`))

      const response = await fetchWith({ content: null, contentSha256: missing, byteSize: 10 })

      expect(response.status).toBe(302)
      expect(response.headers['location']).toBe(SOURCE_URI)
      expect(response.headers['x-license']).toBe(control.headers['x-license'])
      expect(response.headers['link']).toBe(control.headers['link'])
    })
  })
})

describe('a file that is missing and a source address that cannot be redirected to', () => {
  it('answers 404 "image content unavailable"', async () => {
    const storeRoot = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-parity-missing-'))
    configMock.default.imageStoreDirectory = storeRoot
    resetImageStoreForTests()
    vi.mocked(getDefaultListOrderId).mockReturnValue(null)
    const row = {
      ...imageRow('.png', { content: null, contentSha256: 'c'.repeat(64), byteSize: 900 }),
      uri: '/local/path.png',
    }
    vi.mocked(getDrizzle).mockImplementation(() => chainOf([row]) as never)

    const response = await request(buildApp()).get(`/image/direct/${HASH}`)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ error: 'image content unavailable' })
    await fileSystem.rm(storeRoot, { recursive: true, force: true })
  })
})
