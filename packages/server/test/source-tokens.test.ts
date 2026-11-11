import { test } from 'node:test'
import assert from 'assert'
import { inArray } from 'drizzle-orm'
import * as viem from 'viem'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import * as s from '../src/db/schema'
import { getTopTokenAddresses } from '../src/db/source-tokens'
import { topTokensListKey } from '../src/collect/coingecko-top-tokens-settings'
import { readEtherscanSettings } from '../src/collect/etherscan-settings'
import { isDbAvailable } from './db-available'

/**
 * `getTopTokenAddresses` against a real database, with the Etherscan collector's default
 * sources: the CoinGecko top-tokens provider's per-chain lists first, then Routescan's. The
 * seeded rows use the real provider and list keys, because the point is that the default
 * names lists that exist. They live on a throwaway network, and only the lists and that
 * network are removed afterwards.
 */
test(
  'getTopTokenAddresses reads the default Etherscan sources from real rows',
  { skip: !(await isDbAvailable()) && 'no database connection' },
  async (t) => {
    const drizzle = getDrizzle()
    const listIds: string[] = []
    const networkIds: string[] = []
    const chainId = 7771
    const address = (n: number) => viem.padHex(viem.toHex(n), { size: 20 })

    let networkId: string

    const seedList = async ({
      providerKey,
      key,
      patch,
      published,
      members,
    }: {
      providerKey: string
      key: string
      patch: number
      published: boolean
      members: number[]
    }) => {
      const [provider] = await db.insertProvider({ name: providerKey, key: providerKey })
      const [list] = await db.insertList({ providerId: provider.providerId, key, name: key, patch, networkId })
      listIds.push(list.listId)
      for (const [position, member] of members.entries()) {
        const token = await db.insertToken({
          providedId: address(member),
          symbol: `S${member}`,
          name: `Source Token ${member}`,
          decimals: 18,
          networkId,
        })
        await db.insertListToken({ tokenId: token.tokenId, listId: list.listId, listTokenOrderId: position })
      }
      if (published) await db.markListTokensCollected(list.listId)
    }

    t.before(async () => {
      const network = await db.insertNetworkFromChainId(chainId, 'test')
      networkId = network.networkId
      networkIds.push(networkId)
      const coingecko = 'coingecko-top-tokens'
      const key = topTokensListKey(chainId)
      // A superseded published version, the newest published version, and a newer unpublished one.
      await seedList({ providerKey: coingecko, key, patch: 0, published: true, members: [1, 2, 3] })
      await seedList({ providerKey: coingecko, key, patch: 1, published: true, members: [2, 4] })
      await seedList({ providerKey: coingecko, key, patch: 2, published: false, members: [9] })
      await seedList({
        providerKey: 'routescan',
        key: 'top-tokens-testchain',
        patch: 0,
        published: true,
        members: [5, 2],
      })
      await seedList({ providerKey: 'etherscan', key, patch: 0, published: true, members: [8] })
    })

    t.after(async () => {
      await drizzle.transaction(async (tx) => {
        if (listIds.length) await tx.delete(s.list).where(inArray(s.list.listId, listIds))
        if (networkIds.length) await tx.delete(s.network).where(inArray(s.network.networkId, networkIds))
      })
    })

    await t.test(
      'default sources: CoinGecko newest published version first, then Routescan, deduplicated',
      async () => {
        const { sourceLists } = readEtherscanSettings({})
        const found = await getTopTokenAddresses({ networkId, sources: sourceLists, limit: 10 })
        assert.deepStrictEqual(found, [address(2), address(4), address(5)])
      },
    )

    await t.test('the limit cuts the combined list', async () => {
      const { sourceLists } = readEtherscanSettings({})
      const found = await getTopTokenAddresses({ networkId, sources: sourceLists, limit: 2 })
      assert.deepStrictEqual(found, [address(2), address(4)])
    })
  },
)
