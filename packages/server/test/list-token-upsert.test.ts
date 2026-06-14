import { test } from 'node:test'
import assert from 'assert'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import { and, eq, inArray } from 'drizzle-orm'
import * as s from '../src/db/schema'
import * as viem from 'viem'
import { isDbAvailable } from './db-available'

/**
 * Regression: re-collecting a token must refresh its icon.
 *
 * list_token's primary key is keccak256(token_id || list_id) — it excludes
 * image_hash — so re-collection conflicts on an existing (token, list) row.
 * Before the fix, onConflictDoUpdate only re-set the key to itself, so the icon
 * froze at first write and a provider that changed an icon URL (e.g. Internet
 * Money moving off Heroku) kept serving the stale image forever.
 */
test(
  'insertListToken refreshes image_hash on re-collection',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const networkIds: string[] = []
    const imageHashes: string[] = []

    let tokenId: string
    let listId: string
    const IMG_A = viem.keccak256(viem.toBytes('lt-upsert-icon-a')).slice(2)
    const IMG_B = viem.keccak256(viem.toBytes('lt-upsert-icon-b')).slice(2)

    t.before(async () => {
      const [provider] = await db.insertProvider({ name: 'LT Upsert Provider', key: 'lt-upsert-provider' })
      providerIds.push(provider.providerId)

      const network = await db.insertNetworkFromChainId(7777, 'test')
      networkIds.push(network.networkId)

      const [list] = await db.insertList({ providerId: provider.providerId, key: 'lt-upsert-list', default: true })
      listId = list.listId

      const token = await db.insertToken({
        providedId: viem.padHex(viem.toHex(1), { size: 20 }),
        symbol: 'LTU',
        name: 'List Token Upsert',
        decimals: 18,
        networkId: network.networkId,
      })
      tokenId = token.tokenId

      for (const imageHash of [IMG_A, IMG_B]) {
        await drizzle
          .insert(s.image)
          .values({
            imageHash,
            content: Buffer.from([0xff, 0xd8, 0xff]),
            uri: `https://example.com/${imageHash}.png`,
            ext: '.png',
            mode: 'link',
          })
          .onConflictDoNothing()
        imageHashes.push(imageHash)
      }
    })

    t.after(async () => {
      await drizzle.transaction(async (tx) => {
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
        if (imageHashes.length) await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
      })
    })

    const current = async () => {
      const [row] = await drizzle
        .select({ imageHash: s.listToken.imageHash, orderId: s.listToken.listTokenOrderId })
        .from(s.listToken)
        .where(and(eq(s.listToken.tokenId, tokenId), eq(s.listToken.listId, listId)))
        .limit(1)
      return row
    }

    await t.test('first write sets the icon', async () => {
      await db.insertListToken({ tokenId, listId, imageHash: IMG_A, listTokenOrderId: 1 })
      const row = await current()
      assert.strictEqual(row?.imageHash, IMG_A)
      assert.strictEqual(row?.orderId, 1)
    })

    await t.test('changed icon updates image_hash (the bug being fixed)', async () => {
      await db.insertListToken({ tokenId, listId, imageHash: IMG_B, listTokenOrderId: 2 })
      const row = await current()
      assert.strictEqual(row?.imageHash, IMG_B)
      assert.strictEqual(row?.orderId, 2)
    })

    await t.test('a fetch-less run does not clobber a good icon', async () => {
      await db.insertListToken({ tokenId, listId, imageHash: undefined, listTokenOrderId: 3 })
      const row = await current()
      assert.strictEqual(row?.imageHash, IMG_B)
      assert.strictEqual(row?.orderId, 3)
    })
  },
)
