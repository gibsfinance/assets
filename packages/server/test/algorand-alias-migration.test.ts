/**
 * Proves Algorand's ARC-25 chain ids keep working after migration 0020 deletes the
 * duplicate network eip155-4160.
 *
 * Seeds the world production and staging have: Algorand Standard Asset 312769 under
 * BOTH algorand-283 (the home) and a stale eip155-4160. Then it executes the real 0020
 * file, statement by statement in one transaction (matching how drizzle's migrator runs
 * it, since the temporary table is session-scoped), and asserts:
 *   - eip155-4160 is gone and algorand-283 and its token survive;
 *   - /list/tokens/4160, /list/tokens/416001 and /list/tokens/eip155-4160 all answer
 *     with the algorand-283 token;
 *   - /image/4160/312769 serves that token's image;
 *   - 416002 (ARC-25 TestNet, not aliased) does not.
 */
import { test } from 'node:test'
import assert from 'assert'
import * as fs from 'fs'
import supertest from 'supertest'
import * as viem from 'viem'
import { sql as dsql, inArray } from 'drizzle-orm'
import { app } from '../src/server/app'
import * as db from '../src/db'
import * as s from '../src/db/schema'
import { getDrizzle } from '../src/db/drizzle'
import { syncDefaultOrder, buildManifestsFromDB } from '../src/db/sync-order'
import { allCollectables } from '../src/collect/collectables'
import { isDbAvailable } from './db-available'

const MIGRATION_PATH = new URL('../drizzle/0020_remove_algorand_faked_network.sql', import.meta.url).pathname
const TETHER_ASSET_ID = '312769'

test(
  'ARC-25 ids still serve Algorand after migration 0020 deletes eip155-4160',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const networkIds: string[] = []
    const imageHashes: string[] = []

    t.after(async () => {
      await drizzle.transaction(async (tx) => {
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
        if (imageHashes.length) await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
      })
    })

    const [provider] = await db.insertProvider({ name: 'Algorand Alias Test', key: 'algorand-alias-test' })
    providerIds.push(provider.providerId)
    const [list] = await db.insertList({ providerId: provider.providerId, key: 'algorand-alias-list', default: true })

    const image = {
      imageHash: viem.keccak256(viem.toBytes('algorand-alias-image')).slice(2),
      content: Buffer.from([0xff, 0xd8, 0xff]),
      uri: 'https://example.com/algorand-alias.png',
      ext: '.png',
      mode: 'save',
    }
    await drizzle.insert(s.image).values(image).onConflictDoNothing()
    imageHashes.push(image.imageHash)

    const home = await db.insertNetworkFromChainId('algorand-283', 'algorand')
    // The stale duplicate cannot be written through insertNetworkFromChainId, which
    // refuses it on purpose, so insert the row the way the old collectors left it.
    const [duplicate] = await drizzle
      .insert(s.network)
      .values({ networkId: dsql`''`, type: 'evm', chainId: 'eip155-4160' })
      .onConflictDoUpdate({ target: s.network.networkId, set: { networkId: dsql`excluded.network_id` } })
      .returning()
    networkIds.push(home.networkId, duplicate.networkId)

    const homeToken = await db.insertToken({
      providedId: TETHER_ASSET_ID,
      symbol: 'USDt',
      name: 'Tether USD',
      decimals: 6,
      networkId: home.networkId,
    })
    await db.insertToken({
      providedId: TETHER_ASSET_ID,
      symbol: 'USDt',
      name: 'Tether USD',
      decimals: 6,
      networkId: duplicate.networkId,
    })
    await db.insertListToken([
      { tokenId: homeToken.tokenId, listId: list.listId, imageHash: image.imageHash, listTokenOrderId: 0 },
    ])
    const keys = allCollectables()
    await syncDefaultOrder(keys, await buildManifestsFromDB(keys))

    const migrationStatements = fs
      .readFileSync(MIGRATION_PATH, 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)
    await drizzle.transaction(async (tx) => {
      for (const statement of migrationStatements) await tx.execute(dsql.raw(statement))
    })

    const storedChainIds = async () =>
      (await drizzle.select({ chainId: s.network.chainId }).from(s.network)).map((row) => row.chainId)

    await t.test('the migration deletes eip155-4160 and keeps algorand-283', async () => {
      const chainIds = await storedChainIds()
      assert.ok(!chainIds.includes('eip155-4160'), 'eip155-4160 must be deleted')
      assert.ok(chainIds.includes('algorand-283'), 'algorand-283 must survive')
    })

    for (const alias of ['4160', '416001', 'eip155-4160']) {
      await t.test(`/list/tokens/${alias} answers with the algorand-283 token`, async () => {
        const response = await supertest(app).get(`/list/tokens/${alias}`).expect(200)
        const served = response.body.tokens.find((token: { address: string }) => token.address === TETHER_ASSET_ID)
        assert.ok(served, `expected asset ${TETHER_ASSET_ID} in the list`)
        assert.strictEqual(served.chainIdentifier, 'algorand-283')
      })
    }

    await t.test('/image/4160/312769 redirects to the algorand-283 token image', async () => {
      // The token route redirects to the image's source address.
      const response = await supertest(app).get(`/image/4160/${TETHER_ASSET_ID}`).expect(302)
      assert.ok(response.headers['location'] === image.uri, 'expected a redirect to the seeded image')
    })

    await t.test('416002 (ARC-25 TestNet) is not an alias', async () => {
      const response = await supertest(app).get('/list/tokens/416002').expect(200)
      assert.strictEqual(response.body.tokens.length, 0)
    })
  },
)
