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
 * End-to-end proof that `/sprite/:provider/:list?chainId=` narrows to a real chain.
 *
 * `network.chain_id` stores CAIP-2 identifiers, so the endpoint's original
 * `eq(chain_id, '501')` could only match a row whose identifier IS the bare
 * number — none is stored that way. Every bare-numeric filter therefore returned
 * an empty sprite, and because `SpriteOptions.chainId` was typed `number`, a bare
 * number was the only value the software development kit could ever send. Measured
 * against staging before the fix: `?chainId=501` and `?chainId=42161` both answered
 * count 0 on lists holding thousands of those chains' tokens.
 *
 * The unit tests can only assert which query builder was called. This asserts the
 * rows that actually come back, against the real PostgreSQL `split_part`.
 */
test(
  'sprite chainId filter resolves a bare number to the stored identifier',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const providerIds: string[] = []
    const networkIds: string[] = []
    const imageHashes: string[] = []
    const listIds: string[] = []
    const tokenIds: string[] = []

    t.after(async () => {
      await drizzle.transaction(async (tx) => {
        if (listIds.length) await tx.delete(s.listToken).where(inArray(s.listToken.listId, listIds))
        if (listIds.length) await tx.delete(s.list).where(inArray(s.list.listId, listIds))
        if (tokenIds.length) await tx.delete(s.token).where(inArray(s.token.tokenId, tokenIds))
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
        if (providerIds.length) await tx.delete(s.provider).where(inArray(s.provider.providerId, providerIds))
        if (imageHashes.length) {
          await tx.delete(s.link).where(inArray(s.link.imageHash, imageHashes))
          await tx.delete(s.image).where(inArray(s.image.imageHash, imageHashes))
        }
      })
    })

    // Random per-pixel noise: flat color compresses below insertImage's 200-byte
    // minimum-raster guard, which exists to reject placeholder thumbnails.
    const makeNoiseIcon = async (): Promise<Buffer> => {
      const noise = Buffer.alloc(64 * 64 * 4)
      for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256)
      return sharp(noise, { raw: { width: 64, height: 64, channels: 4 } })
        .png()
        .toBuffer()
    }

    const [provider] = await db.insertProvider({
      key: 'sprite-chain-filter-test-provider',
      name: 'Sprite Chain Filter Test Provider',
    })
    providerIds.push(provider.providerId)

    const [list] = await db.insertList({ providerId: provider.providerId, key: 'sprite-chain-filter-test-list' })
    listIds.push(list.listId)

    /** Seed one token with an icon on `chainId`, and return the sprite key it must produce. */
    const seedToken = async (chainId: string, namespace: string, providedId: string) => {
      const network = await db.insertNetworkFromChainId(chainId, namespace)
      networkIds.push(network.networkId)
      assert.strictEqual(network.chainId, chainId)

      const token = await db.insertToken({
        networkId: network.networkId,
        providedId,
        name: `Token on ${chainId}`,
        symbol: 'TFT',
        decimals: 18,
      })
      tokenIds.push(token.tokenId)

      const stored = await db.insertImage({
        providerKey: provider.key,
        originalUri: `https://example.com/sprite-chain-filter-${chainId}.png`,
        listId: list.listId,
        image: await makeNoiseIcon(),
      })
      assert.ok(stored?.image.imageHash, `expected an image row for ${chainId}`)
      imageHashes.push(stored.image.imageHash)

      await db.insertListToken({
        listId: list.listId,
        tokenId: token.tokenId,
        imageHash: stored.image.imageHash,
        listTokenOrderId: 0,
      })
      return `${chainId}-${providedId}`
    }

    // 501 is one of the eleven numbers two namespaces both claim. Seeding BOTH is
    // what makes the namespace assertions below meaningful rather than vacuous.
    const solanaMint = 'GozPNCAseytzxCR3d2k8hTsTYkr4SDpuXy2RQAZFVx2g'
    const solanaKey = await seedToken('solana-501', 'solana', solanaMint)
    const columbusAddress = '0x00000000000000000000000000000000000005c1'
    const columbusKey = await seedToken('eip155-501', 'evm', columbusAddress)

    const manifestFor = async (query: string) => {
      const response = await supertest(app).get(`/sprite/${provider.key}/${list.key}${query}`).expect(200)
      return response.body as { count: number; tokens: Record<string, unknown> }
    }

    await t.test('unfiltered manifest carries both chains', async () => {
      const body = await manifestFor('')
      assert.ok(Object.keys(body.tokens).includes(solanaKey), 'expected the Solana token')
      assert.ok(Object.keys(body.tokens).includes(columbusKey), 'expected the eip155-501 token')
    })

    await t.test('a bare 501 reaches BOTH chains carrying that reference', async () => {
      // The regression: this returned count 0, because no row's identifier is "501".
      const body = await manifestFor('?chainId=501')
      const keys = Object.keys(body.tokens)
      assert.ok(keys.includes(solanaKey), 'a bare 501 must reach solana-501')
      assert.ok(keys.includes(columbusKey), 'a bare 501 must reach eip155-501')
    })

    await t.test('an explicit solana-501 never widens to the eip155 chain', async () => {
      const body = await manifestFor('?chainId=solana-501')
      const keys = Object.keys(body.tokens)
      assert.deepStrictEqual(keys, [solanaKey])
    })

    await t.test('an explicit eip155-501 never widens to Solana', async () => {
      const body = await manifestFor('?chainId=eip155-501')
      const keys = Object.keys(body.tokens)
      assert.deepStrictEqual(keys, [columbusKey])
    })

    await t.test('the sheet narrows identically, so grid coordinates stay in step', async () => {
      // A sheet that filtered differently from the manifest would hand back
      // coordinates addressing the wrong cells.
      const response = await supertest(app)
        .get(`/sprite/${provider.key}/${list.key}/sheet?chainId=solana-501`)
        .expect(200)
      assert.strictEqual(response.headers['x-sprite-count'], '1')
    })

    await t.test('the manifest key carries the identifier, never the bare reference', async () => {
      // The half of the contract @gibs/sdk reads back — see fixtures/sprite-key-contract.json.
      const body = await manifestFor('?chainId=solana-501')
      const [key] = Object.keys(body.tokens)
      assert.strictEqual(key, `solana-501-${solanaMint}`, 'base58 mints are case-significant and must survive')
      assert.ok(!/^\d+-/.test(key), 'a key must never lead with a bare chain number')
    })
  },
)
