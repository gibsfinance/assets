import '../src/global.d.ts'
import { test, afterEach, beforeEach, describe } from 'node:test'
import { app } from '../src/server/app'
import supertest from 'supertest'
import { tableNames } from '../src/db/tables'
import { List, Provider } from 'knex/types/tables'
import assert from 'assert'
import * as testUtils from './utils.ts'
import { TokenList } from '../src/types.ts'
import _ from 'lodash'

describe('/list', async (t) => {
  let provider!: Provider
  let list!: List
  beforeEach(async () => {
    await testUtils.setup()
    provider = testUtils.get(tableNames.provider)
    list = testUtils.get(tableNames.list)
  })
  afterEach(async () => testUtils.teardown())
  await describe('/:providerKey', async () => {
    let baseline!: TokenList
    beforeEach(async () => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}`)
        .expect(200)
      baseline = res.body
    })
    await test('/:listKey?', async () => {
      assert.ok(baseline.tokens.length > 0)
    })
    await test('filter by chain id', async () => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}?chainId=1`)
        .expect(200)
      assert.ok(baseline.tokens.length > res.body.tokens.length)
      assert.ok(_.every(res.body.tokens, {
        chainId: 1,
      }))
    })
    await test('filter by decimals', async () => {
      const res = await supertest(app).get(`/list/${provider.key}/${list.key}?decimals=8`)
        .expect(200)
      assert.ok(baseline.tokens.length > res.body.tokens.length)
      assert.ok(_.every(res.body.tokens, {
        decimals: 8,
      }))
    })
  })
})
