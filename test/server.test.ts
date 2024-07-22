import supertest from 'supertest'
import { test } from 'node:test'
import { app } from '../src/server/app'
import * as testUtils from './utils'
import { tableNames } from '../src/db/tables'

test('middleware', async (t) => {
  t.beforeEach(async () => testUtils.setup())
  t.afterEach(async () => testUtils.teardown())
  await t.test('it responds with a response time', async () => {
    const provider = testUtils.get(tableNames.provider)
    const list = testUtils.get(tableNames.list)
    await supertest(app)
      .get(`/list/${provider.key}/${list.key}`)
      .expect('x-response-time', /\d+\.?\d+/)
      .expect('Content-Type', /json/)
      .expect(200)
  })
})
