import { test } from 'node:test'
import assert from 'assert'
import supertest from 'supertest'
import { app } from '../src/server/app'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import { inArray } from 'drizzle-orm'
import * as s from '../src/db/schema'
import * as viem from 'viem'
import { syncDefaultOrder, buildManifestsFromDB } from '../src/db/sync-order'
import { allCollectables } from '../src/collect/collectables'
import { isDbAvailable } from './db-available'

/** Smoke test: stats `count` for a chain must equal the `total` in /list/tokens response. */
test(
  '/stats and /list/tokens are consistent',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const networkIds: string[] = []
    const imageHashes: string[] = []

    t.beforeEach(async () => {
      const [provider] = await db.insertProvider({ name: 'Smoke Provider', key: 'smoke-provider' })
      providerIds.push(provider.providerId)

      const network = await db.insertNetworkFromChainId(8888, 'test')
      networkIds.push(network.networkId)

      const [list] = await db.insertList({
        providerId: provider.providerId,
        key: 'smoke-list',
        default: true,
      })

      const image = {
        imageHash: viem.keccak256(viem.toBytes('smoke-image')).slice(2),
        content: Buffer.from([0xff, 0xd8, 0xff]),
        uri: 'https://example.com/icon.png',
        ext: '.png',
        mode: 'link',
      }
      await drizzle.insert(s.image).values(image).onConflictDoNothing()
      imageHashes.push(image.imageHash)

      // Insert 5 tokens, only 3 of which have a list_token with the image
      const tokens: Array<{ tokenId: string }> = []
      for (let i = 0; i < 5; i++) {
        const token = await db.insertToken({
          providedId: viem.padHex(viem.toHex(i + 1), { size: 20 }),
          symbol: `TOK${i}`,
          name: `Token ${i}`,
          decimals: 18,
          networkId: network.networkId,
        })
        tokens.push(token)
      }

      await db.insertListToken(
        tokens.slice(0, 3).map((token, i) => ({
          tokenId: token.tokenId,
          listId: list.listId,
          imageHash: image.imageHash,
          listTokenOrderId: i,
        })),
      )
      await db.insertListToken(
        tokens.slice(3).map((token, i) => ({
          tokenId: token.tokenId,
          listId: list.listId,
          listTokenOrderId: i + 3,
        })),
      )

      // Seed a default list order so the ranking query has something to join against
      const keys = allCollectables()
      const manifests = await buildManifestsFromDB(keys)
      await syncDefaultOrder(keys, manifests)
    })

    t.afterEach(async () => {
      await drizzle.transaction(async (tx) => {
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
        if (imageHashes.length) await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
      })
      providerIds.length = 0
      networkIds.length = 0
      imageHashes.length = 0
    })

    await t.test('stats count matches token list total for chain 8888', async () => {
      const stats = await supertest(app).get('/stats').expect(200)
      const chain8888Stats = stats.body.find((r: { chainId: string }) => r.chainId === '8888')
      assert.ok(chain8888Stats, 'chain 8888 should appear in stats')
      assert.strictEqual(chain8888Stats.count, 3, 'stats should report 3 tokens with images')

      const tokens = await supertest(app).get('/list/tokens/8888').expect(200)
      assert.strictEqual(tokens.body.total, chain8888Stats.count, 'token list total must equal stats count')
    })
  },
)

/**
 * Regression for the stats↔list delta on ETH/BSC/Base. Images can have uri='' or
 * ext='' in production — SQL `IS NOT NULL` passed the empty string but JS
 * `imageHash && ext` / `.filter(e => e.logoURI)` treated empty strings as falsy.
 * Stats over-counted; the list dropped the row. Both sides now use COALESCE <> ''.
 */
test(
  'empty-string uri/ext are excluded on both stats and list sides',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const networkIds: string[] = []
    const imageHashes: string[] = []

    t.beforeEach(async () => {
      const [provider] = await db.insertProvider({ name: 'Empty Image Provider', key: 'empty-image-provider' })
      providerIds.push(provider.providerId)

      const network = await db.insertNetworkFromChainId(9999, 'test')
      networkIds.push(network.networkId)

      const [list] = await db.insertList({ providerId: provider.providerId, key: 'empty-image-list', default: true })

      const goodImage = {
        imageHash: viem.keccak256(viem.toBytes('good-image')).slice(2),
        content: Buffer.from([0xff, 0xd8, 0xff]),
        uri: 'https://example.com/icon.png',
        ext: '.png',
        mode: 'link',
      }
      const emptyUriImage = {
        imageHash: viem.keccak256(viem.toBytes('empty-uri')).slice(2),
        content: Buffer.from([0xff, 0xd8, 0xff]),
        uri: '',
        ext: '.png',
        mode: 'link',
      }
      const emptyExtImage = {
        imageHash: viem.keccak256(viem.toBytes('empty-ext')).slice(2),
        content: Buffer.from([0xff, 0xd8, 0xff]),
        uri: 'https://example.com/unused.png',
        ext: '',
        mode: 'save',
      }
      await drizzle.insert(s.image).values([goodImage, emptyUriImage, emptyExtImage]).onConflictDoNothing()
      imageHashes.push(goodImage.imageHash, emptyUriImage.imageHash, emptyExtImage.imageHash)

      const tokens: Array<{ tokenId: string }> = []
      for (let i = 0; i < 3; i++) {
        const token = await db.insertToken({
          providedId: viem.padHex(viem.toHex(i + 1), { size: 20 }),
          symbol: `EMP${i}`,
          name: `Empty ${i}`,
          decimals: 18,
          networkId: network.networkId,
        })
        tokens.push(token)
      }

      await db.insertListToken([
        { tokenId: tokens[0].tokenId, listId: list.listId, imageHash: goodImage.imageHash, listTokenOrderId: 0 },
        { tokenId: tokens[1].tokenId, listId: list.listId, imageHash: emptyUriImage.imageHash, listTokenOrderId: 1 },
        { tokenId: tokens[2].tokenId, listId: list.listId, imageHash: emptyExtImage.imageHash, listTokenOrderId: 2 },
      ])

      const keys = allCollectables()
      const manifests = await buildManifestsFromDB(keys)
      await syncDefaultOrder(keys, manifests)
    })

    t.afterEach(async () => {
      await drizzle.transaction(async (tx) => {
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
        if (imageHashes.length) await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
      })
      providerIds.length = 0
      networkIds.length = 0
      imageHashes.length = 0
    })

    await t.test('stats count excludes empty uri/ext, matching the list total', async () => {
      // Call db.getTokenCountsByChain directly — /stats is memoized for 1h
      // so it returns stale results across tests in the same run.
      const counts = await db.getTokenCountsByChain()
      const chainStats = counts.find((r) => r.chainId === 'eip155-9999')
      assert.ok(chainStats, 'chain 9999 should appear in token counts')
      assert.strictEqual(chainStats.count, 1, 'only the token with a non-empty-uri image should count')

      const tokens = await supertest(app).get('/list/tokens/9999').expect(200)
      assert.strictEqual(tokens.body.total, chainStats.count, 'list total must match stats count')
    })
  },
)
