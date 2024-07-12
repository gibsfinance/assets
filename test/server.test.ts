import supertest from 'supertest'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { app } from '../src/server/app'
import * as testUtils from './utils'
import { tableNames } from '../src/db/tables'

describe('middleware', async () => {
  beforeEach(async () => testUtils.setup())
  afterEach(async () => testUtils.teardown())
  test('it responds with a response time', async () => {
    const provider = testUtils.get(tableNames.provider)
    const list = testUtils.get(tableNames.list)
    await supertest(app)
      .get(`/list/${provider.key}/${list.key}`)
      .expect('x-response-time', /\d+\.?\d+/)
      .expect('Content-Type', /json/)
      .expect(200)
  })
})
