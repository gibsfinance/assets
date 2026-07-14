import { test } from 'node:test'
import assert from 'assert'
import supertest from 'supertest'
import sharp from 'sharp'
import { inArray } from 'drizzle-orm'
import { app } from '../src/server/app'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import * as s from '../src/db/schema'
import { toPublicNetwork } from '../src/server/networks'
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
    const makeNoiseLogo = async (): Promise<Buffer> => {
      const noise = Buffer.alloc(64 * 64 * 4)
      for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256)
      return sharp(noise, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toBuffer()
    }

    const seedChainLogo = async (chainId: string, namespace: string) => {
      const seededNetwork = await db.insertNetworkFromChainId(chainId, namespace)
      networkIds.push(seededNetwork.networkId)
      assert.strictEqual(seededNetwork.chainId, chainId)
      assert.strictEqual(seededNetwork.type, namespace)
      const stored = await db.fetchImageAndStoreForNetwork({
        network: seededNetwork,
        uri: await makeNoiseLogo(),
        originalUri: `https://example.com/non-evm-image-test-${chainId}.png`,
        providerKey: provider.key,
      })
      assert.ok(stored?.network.imageHash, `expected the ${chainId} network row to be linked to a stored image`)
      imageHashes.push(stored!.image.imageHash)
    }

    // bip122-0 (Bitcoin) is the original family; sui-784 (Sui) is a namespace
    // added later -- both must round-trip so the added 'sui' network type is
    // proven, not assumed, to hash identically in PostgreSQL and JavaScript.
    await seedChainLogo('bip122-0', 'bip122')
    await seedChainLogo('sui-784', 'sui')

    for (const identifier of ['bip122-0', 'sui-784']) {
      await t.test(`resolves /image/${identifier} to the stored logo`, async () => {
        const response = await supertest(app).get(`/image/${identifier}`).expect(200)
        assert.match(response.headers['content-type'], /^image\//)
      })
    }

    await t.test('appears in the public network listing with both identifier forms', async () => {
      // Assert against a fresh database read mapped through the same
      // toPublicNetwork transform and asset-0 filter the /networks route
      // uses, rather than calling the route directly: getNetworks caches its
      // result for one hour in a process-global singleton with no
      // invalidation hook, so a cache warmed by another test file before
      // this row is seeded would make an HTTP-route assertion depend on test
      // ordering. Replicating the route's two operations against live data
      // proves the same thing -- this chain is listed with the right shape
      // and is not filtered like the asset-0 sentinel -- without the
      // ordering fragility. The HTTP /networks route itself is covered by
      // networks.test.
      const rows = await getDrizzle().select().from(s.network)
      const listing = rows.filter((n) => n.chainId !== 'asset-0').map(toPublicNetwork)
      const bitcoin = listing.find((n) => n.chainIdentifier === 'bip122-0')
      assert.ok(bitcoin, 'expected the bip122-0 network to appear in the public listing')
      assert.strictEqual(bitcoin!.chainId, '0')
      assert.strictEqual(bitcoin!.type, 'bip122')
      const sui = listing.find((n) => n.chainIdentifier === 'sui-784')
      assert.ok(sui, 'expected the sui-784 network to appear in the public listing')
      assert.strictEqual(sui!.chainId, '784')
      assert.strictEqual(sui!.type, 'sui')
    })
  },
)
