import '../src/global.d.ts'
import test from 'node:test'
import { app } from '../src/server/app'
import * as db from '../src/db'
import supertest from 'supertest'
import { tableNames } from '../src/db/tables'
import { List, Provider } from 'knex/types/tables'
import assert from 'assert'
import * as utils from '../src/utils'
import { zeroAddress } from 'viem'

test('/list', async (t) => {
  let provider!: Provider
  let list!: List
  let list2!: List
  t.beforeEach(async () => {
    provider = await db.insertProvider({
      name: 'Provider ABC',
      key: 'provider-abc',
    })
    list = await db.insertList({
      providerId: provider.providerId,
      key: 'list-abc',
      default: true,
    })
    list2 = await db.insertList({
      providerId: provider.providerId,
      key: 'list-abc2',
    })
    await db.insertNetworkFromChainId(10_001)
    const token = await db.insertToken({
      providedId: zeroAddress,
      symbol: 'ETH',
      name: 'Ether',
      decimals: 18,
      networkId: utils.chainIdToNetworkId(10_001),
    })
    await db.insertListToken({
      providedId: token.providedId,
      networkId: token.networkId,
      listId: list.listId,
    })
  })
  t.afterEach(async () => {
    await db.getDB().from(tableNames.provider)
      .delete()
      .where({
        providerId: provider.providerId,
      })
  })
  await t.test('/:providerKey', async (t) => {
    await t.test('/:listKey?', async (t) => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}`)
        .expect(200)
      // console.log(res)
      assert.strictEqual(true, true)
    })
  })
  await t.test('filter by chain id', async () => {
    const res = await supertest(app).get(`/list/${provider.key}/${list.key}?chainId=10001`)
      .expect(200)
    console.log(res.body)
  })
})
