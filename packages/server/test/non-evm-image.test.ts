import { test } from 'node:test'
import assert from 'assert'
import supertest from 'supertest'
import sharp from 'sharp'
import { inArray } from 'drizzle-orm'
import { app } from '../src/server/app'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import * as s from '../src/db/schema'
import { isDbAvailable } from './db-available'

/**
 * End-to-end proof that a stored non-Ethereum-Virtual-Machine chain logo is
 * reachable through the public image route.
 *
 * This only passes if the JavaScript `chainIdToNetworkId` reproduces the
 * PostgreSQL trigger's stored `network_id` hash for a `bip122` chain
 * identifier: the network row is inserted through the real trigger
 * (`insertNetworkFromChainId`), while the image route looks the row back up
 * through the JavaScript hash (`utils.chainIdToNetworkId`) inside
 * `getNetworkIcon`. If those two hash functions ever disagree, this test
 * fails at the lookup instead of silently passing on a coincidence.
 */
test(
  'serves a non-Ethereum-Virtual-Machine chain logo end to end',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const networkIds: string[] = []
    const imageHashes: string[] = []

    t.after(async () => {
      await drizzle.transaction(async (tx) => {
        // Network references image via image_hash, so it must be cleared
        // before the image row it points at can be deleted.
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (imageHashes.length) {
          await tx.delete(s.link).where(inArray(s.link.imageHash, imageHashes))
          await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
        }
      })
    })

    // A dedicated test-only provider key -- 'cryptocurrency-icons' is a real
    // collector key already used by the running server, so reusing it here
    // would risk the cleanup step deleting a legitimate provider row.
    const [provider] = await db.insertProvider({
      key: 'non-evm-image-test-provider',
      name: 'Non Ethereum Virtual Machine Image Test Provider',
    })
    providerIds.push(provider.providerId)

    const network = await db.insertNetworkFromChainId('bip122-0', 'bip122')
    networkIds.push(network.networkId)
    assert.strictEqual(network.chainId, 'bip122-0')
    assert.strictEqual(network.type, 'bip122')

    // A bare 1x1 PNG (or any solid-color raster) is smaller than the
    // 200-byte minimum-raster-size guard in insertImage (meant to reject
    // thumbnail-sized placeholders), because PNG compresses flat color down
    // to well under 200 bytes. Random per-pixel noise defeats that
    // compression so the encoded buffer clears the guard.
    const noise = Buffer.alloc(64 * 64 * 4)
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256)
    const logo = await sharp(noise, { raw: { width: 64, height: 64, channels: 4 } })
      .png()
      .toBuffer()

    const stored = await db.fetchImageAndStoreForNetwork({
      network,
      uri: logo,
      originalUri: 'https://example.com/non-evm-image-test-logo.png',
      providerKey: provider.key,
    })
    assert.ok(stored?.network.imageHash, 'expected the network row to be linked to a stored image')
    imageHashes.push(stored!.image.imageHash)

    await t.test('resolves /image/bip122-0 to the stored logo', async () => {
      const response = await supertest(app).get('/image/bip122-0').expect(200)
      assert.match(response.headers['content-type'], /^image\//)
    })

    await t.test('lists the chain from /networks with both identifier forms', async () => {
      const response = await supertest(app).get('/networks').expect(200)
      const body = response.body as Array<{ chainId: string; chainIdentifier: string; type: string }>
      const found = body.find((n) => n.chainIdentifier === 'bip122-0')
      assert.ok(found, `expected /networks to include bip122-0, got ${JSON.stringify(body)}`)
      assert.strictEqual(found!.chainId, '0')
      assert.strictEqual(found!.type, 'bip122')
    })
  },
)
