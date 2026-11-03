import { test } from 'node:test'
import assert from 'assert'
import supertest from 'supertest'
import sharp from 'sharp'
import * as viem from 'viem'
import { inArray, like } from 'drizzle-orm'
import { app } from '../src/server/app'
import config from '../config'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import * as s from '../src/db/schema'
import { syncDefaultOrder, buildManifestsFromDB, getDefaultListOrderId } from '../src/db/sync-order'
import { isDbAvailable } from './db-available'

/**
 * One token, one canonical image.
 *
 * A token list's `logoURI` and the by-address image route used to pick their image
 * with two different rules. The list read only the newest version of each list and
 * ranked without regard to format; the image route read every version ever stored,
 * superseded ones included, and preferred vector artwork. The same token could
 * therefore show one picture in a wallet that reads the list and another in a page
 * that asks for the image by address.
 *
 * Each case below seeds a token whose two answers used to differ, then asks both
 * routes and compares the bytes a consumer actually receives — not the URL shape.
 */

/** Chain id no other test uses; type 'evm' so the image route's network hash finds it. */
const CHAIN_ID = 987_651
const PROVIDER_KEY_PREFIX = 'canonical-image-'

/** Deterministic noise so each image is a distinct, servable raster above the 200-byte floor. */
const noisePng = async (seed: number): Promise<Buffer> => {
  const pixels = Buffer.alloc(32 * 32 * 4)
  let state = seed
  for (let i = 0; i < pixels.length; i++) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    pixels[i] = state % 256
  }
  return sharp(pixels, { raw: { width: 32, height: 32, channels: 4 } })
    .png()
    .toBuffer()
}

const imageRow = (label: string, content: Buffer, ext: string) => ({
  imageHash: viem.keccak256(viem.toBytes(`canonical-image-test:${label}`)).slice(2),
  content,
  uri: `https://example.com/canonical-image-test/${label}${ext}`,
  ext,
  mode: 'save',
})

/**
 * Read a response as raw bytes whatever its content type. Without this, superagent
 * parses an svg response as text and leaves `body` empty, so two different vector
 * images would compare equal.
 */
const fetchBytes = async (path: string): Promise<Buffer> => {
  const response = await supertest(app)
    .get(path)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => callback(null, Buffer.concat(chunks)))
    })
    .expect(200)
  return response.body as Buffer
}

/** Fetch what a consumer receives at an absolute logoURI served by this app. */
const fetchLogo = (logoURI: string) => {
  assert.ok(logoURI.startsWith(`${config.rootURI}/`), `logoURI must point at this service, got ${logoURI}`)
  return fetchBytes(new URL(logoURI).pathname)
}

const fetchByAddress = (address: string) => fetchBytes(`/image/${CHAIN_ID}/${address}`)

test(
  'a token list logoURI and the by-address image route serve the same image',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const imageHashes: string[] = []
    let networkId = ''

    const clearListCache = () => drizzle.delete(s.cacheRequest).where(like(s.cacheRequest.key, `%${CHAIN_ID}%`))

    t.after(async () => {
      await drizzle.transaction(async (tx) => {
        // The default order this test synced points at the seeded providers.
        if (providerIds.length) await tx.delete(s.listOrderItem).where(inArray(s.listOrderItem.providerId, providerIds))
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (networkId) await tx.delete(s.network).where(inArray(s.network.networkId, [networkId]))
        if (imageHashes.length) await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
      })
      await clearListCache()
    })

    // A body cached by an earlier run against this database would answer instead of the query.
    await clearListCache()
    const network = await db.insertNetworkFromChainId(CHAIN_ID, 'evm')
    networkId = network.networkId

    const insertProvider = async (key: string) => {
      const [provider] = await db.insertProvider({ key: `${PROVIDER_KEY_PREFIX}${key}`, name: key })
      providerIds.push(provider.providerId)
      return provider
    }
    const insertImage = async (row: ReturnType<typeof imageRow>) => {
      await drizzle.insert(s.image).values(row).onConflictDoNothing()
      imageHashes.push(row.imageHash)
      return row
    }
    const insertToken = (index: number) =>
      db.insertToken({
        providedId: viem.padHex(viem.toHex(0xca0000 + index), { size: 20 }),
        symbol: `CANON${index}`,
        name: `Canonical ${index}`,
        decimals: 18,
        networkId: network.networkId,
      })
    const insertCollectedList = async (
      providerId: string,
      key: string,
      version: { major: number; minor?: number; patch?: number },
    ) => {
      const [list] = await db.insertList({ providerId, key, minor: 0, patch: 0, ...version })
      await db.markListTokensCollected(list.listId)
      return list
    }

    // Case 1 — a superseded list version. `retired` carried the token in version 1 and
    // dropped it from version 2; `current` carries it today. The list reads only the
    // newest version of each list, so it can only answer with `current`. The image route
    // used to read version 1 as well, and version 1 outranks `current` on version number.
    const superseded = await insertToken(1)
    const retiredProvider = await insertProvider('retired')
    const currentProvider = await insertProvider('current')
    const retiredImage = await insertImage(imageRow('retired', await noisePng(1), '.png'))
    const currentImage = await insertImage(imageRow('current', await noisePng(2), '.png'))
    const retiredV1 = await insertCollectedList(retiredProvider.providerId, 'retired', { major: 1 })
    await insertCollectedList(retiredProvider.providerId, 'retired', { major: 2 })
    const currentList = await insertCollectedList(currentProvider.providerId, 'current', { major: 0, patch: 1 })

    // Case 2 — two formats from one provider. The image route prefers vector artwork; the
    // list used to fall through to list key order and pick the raster.
    const twoFormats = await insertToken(2)
    const formatProvider = await insertProvider('formats')
    const rasterImage = await insertImage(imageRow('raster', await noisePng(3), '.png'))
    const vectorImage = await insertImage(
      imageRow(
        'vector',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'),
        '.svg',
      ),
    )
    const rasterList = await insertCollectedList(formatProvider.providerId, 'a-raster', { major: 0 })
    const vectorList = await insertCollectedList(formatProvider.providerId, 'b-vector', { major: 0 })

    await db.insertListToken([
      { tokenId: superseded.tokenId, listId: retiredV1.listId, imageHash: retiredImage.imageHash, listTokenOrderId: 0 },
      {
        tokenId: superseded.tokenId,
        listId: currentList.listId,
        imageHash: currentImage.imageHash,
        listTokenOrderId: 0,
      },
      { tokenId: twoFormats.tokenId, listId: rasterList.listId, imageHash: rasterImage.imageHash, listTokenOrderId: 0 },
      { tokenId: twoFormats.tokenId, listId: vectorList.listId, imageHash: vectorImage.imageHash, listTokenOrderId: 0 },
    ])

    // Rank the seeded providers, in this order, as the default order. Without a default
    // order both routes skip ranking entirely, and the comparison would prove nothing.
    // `retired` ranks above `current` — the production shape, where a higher-ranked
    // provider's superseded list beat a lower-ranked provider's current one.
    const keys = [retiredProvider.key, currentProvider.key, formatProvider.key]
    await syncDefaultOrder(keys, await buildManifestsFromDB(keys))
    assert.ok(getDefaultListOrderId(), 'a default order must exist for the ranked paths to run')

    const list = await supertest(app).get(`/list/tokens/${CHAIN_ID}`).expect(200)
    const logoFor = (address: string) => {
      const entry = list.body.tokens.find((token: { address: string }) => token.address === address)
      assert.ok(entry, `token ${address} must appear in the list`)
      return entry.logoURI as string
    }

    await t.test('a superseded list version never outranks a current one', async () => {
      const fromList = await fetchLogo(logoFor(superseded.providedId))
      const fromImage = await fetchByAddress(superseded.providedId)
      assert.ok(fromImage.equals(currentImage.content), 'the image route must serve the current list entry')
      assert.ok(fromList.equals(fromImage), 'the list and the image route must agree')
    })

    await t.test('both routes apply the same format preference', async () => {
      const fromList = await fetchLogo(logoFor(twoFormats.providedId))
      const fromImage = await fetchByAddress(twoFormats.providedId)
      assert.ok(fromImage.equals(vectorImage.content), 'the image route keeps preferring vector artwork')
      assert.ok(fromList.equals(fromImage), 'the list and the image route must agree')
    })
  },
)
