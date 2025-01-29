import supertest from 'supertest'
import { test } from 'node:test'
import { app } from '../src/server/app'
import * as testUtils from './utils'
import _ from 'lodash'
import assert from 'assert'

test('networks', async (t) => {
  t.beforeEach(async () => testUtils.setup())
  t.afterEach(async () => testUtils.teardown())
  await t.test('it responds with a list of network ids', async () => {
    const networks = await supertest(app)
      .get('/networks')
      .expect('x-response-time', /\d+\.?\d+/)
      .expect('Content-Type', /json/)
      .expect(200)
    assert.ok(networks.body.length > 0, 'networks should be an array')
    for (const chainId of networks.body) {
      assert.ok(_.isString(chainId), 'all networks should be strings')
    }
  })
})
