import { test } from 'node:test'
import { app } from '../src/server/app'
import supertest from 'supertest'
import { tableNames } from '../src/db/tables'
import type { List, Provider } from 'knex/types/tables'
import assert from 'assert'
import * as testUtils from './utils.ts'
import { TokenList } from '../src/types.ts'
import _ from 'lodash'

test('/list', async (t) => {
  let provider!: Provider
  let list!: List
  t.beforeEach(async () => {
    await testUtils.setup()
    provider = testUtils.get(tableNames.provider)
    list = testUtils.get(tableNames.list)
  })
  t.afterEach(async () => {
    await testUtils.teardown()
  })
  await t.test('/:providerKey', async (t) => {
    let baseline!: TokenList
    t.beforeEach(async () => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}`).expect(200)
      baseline = res.body
    })
    await t.test('/:listKey?', async () => {
      assert.ok(baseline.tokens.length > 0)
    })
    await t.test('filter by chain id', async () => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}?chainId=1`).expect(200)
      assert.ok(baseline.tokens.length > res.body.tokens.length)
      assert.ok(
        _.every(res.body.tokens, {
          chainId: 1,
        }),
      )
    })
    await t.test('filter by decimals', async () => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}?decimals=8`).expect(200)
      assert.ok(baseline.tokens.length > res.body.tokens.length)
      assert.ok(
        _.every(res.body.tokens, {
          decimals: 8,
        }),
      )
    })
  })
  // await t.test('extensions=bridgeInfo', async (t) => {
  //   let tokenList!: TokenList
  //   t.beforeEach(async () => {
  //     const res = await supertest(app).get(`/list/${provider.key}/${list.key}?extensions=bridgeInfo`).expect(200)
  //     tokenList = res.body
  //   })
  //   await t.test('bridge', () => {
  //     assert.ok(0 < tokenList.tokens.length)
  //     assert.ok(!_.isEmpty(tokenList.tokens[0].extensions))
  //   })
  // })
})
