import supertest from 'supertest'
import { test } from 'node:test'
import { app } from '../src/server/app'
import * as testUtils from './utils'
import _ from 'lodash'
import assert from 'assert'
import * as db from '../src/db'
import { toPublicNetwork } from '../src/server/networks'
import { isDbAvailable } from './db-available'

test('networks', { skip: !(await isDbAvailable()) && 'no database connection' }, async (t) => {
  t.beforeEach(async () => testUtils.setup())
  t.afterEach(async () => testUtils.teardown())
  await t.test('it responds with a list of network ids', async () => {
    const networks = await supertest(app)
      .get('/networks')
      .expect('x-response-time', /\d+\.?\d+/)
      .expect('Content-Type', /json/)
      .expect(200)
    assert.ok(networks.body.length > 0, 'networks should be an array')
    for (const { chainId } of networks.body) {
      assert.ok(_.isString(chainId), `all networks should be strings ${JSON.stringify(networks.body)}`)
    }
  })

  /**
   * The name a collector writes has to survive the trip back out to a client, because
   * that response is the only way the studio drawer learns what a chain the client's
   * vendored map has never heard of is called.
   *
   * Goes through db.getNetworks + toPublicNetwork rather than GET /networks on purpose:
   * the route wraps its query in cacheResult with a one-hour window, so a request here
   * would be served the array cached by the first test above and would pass or fail on
   * whether that cache happened to be warm. The route's own shape is covered by
   * src/server/networks/index.test.ts against mocked rows; what needs a real database
   * is that the column itself round-trips.
   */
  await t.test('it round-trips a stored network name through the public mapping', async () => {
    const network = await db.insertNetworkFromChainId(8891, 'test')
    await db.setNetworkName({ networkId: network.networkId, name: 'Round Trip Chain' })

    const stored = (await db.getNetworks()).find((n) => n.networkId === network.networkId)
    assert.ok(stored, 'the seeded network should be stored')
    assert.strictEqual(toPublicNetwork(stored).name, 'Round Trip Chain')
  })

  // A network no collector ever named must still serve, carrying an explicit null so
  // the client knows to fall back rather than render an empty label.
  await t.test('it maps a network nobody named to a null name', async () => {
    const network = await db.insertNetworkFromChainId(8892, 'test')

    const stored = (await db.getNetworks()).find((n) => n.networkId === network.networkId)
    assert.ok(stored, 'the seeded network should be stored')
    assert.strictEqual(toPublicNetwork(stored).name, null)
  })
})

test('setNetworkName', { skip: !(await isDbAvailable()) && 'no database connection' }, async (t) => {
  t.beforeEach(async () => testUtils.setup())
  t.afterEach(async () => testUtils.teardown())

  const nameOf = async (networkId: string) => {
    const networks = await db.getNetworks()
    return networks.find((n) => n.networkId === networkId)?.name
  }

  await t.test('it stores a trimmed name', async () => {
    const network = await db.insertNetworkFromChainId(8893, 'test')
    await db.setNetworkName({ networkId: network.networkId, name: '  Padded Chain  ' })
    assert.strictEqual(await nameOf(network.networkId), 'Padded Chain')
  })

  await t.test('it overwrites an earlier name so a rename upstream lands', async () => {
    const network = await db.insertNetworkFromChainId(8894, 'test')
    await db.setNetworkName({ networkId: network.networkId, name: 'Old Name' })
    await db.setNetworkName({ networkId: network.networkId, name: 'New Name' })
    assert.strictEqual(await nameOf(network.networkId), 'New Name')
  })

  /**
   * A blank name must not overwrite a good one. The registry ships nameless chains, so
   * without this guard a single malformed entry would blank a label that a previous
   * run had recorded correctly — and an empty string reads as "named" downstream,
   * suppressing the fallback and rendering nothing at all.
   */
  await t.test('it leaves an existing name alone when handed a blank or missing one', async () => {
    const network = await db.insertNetworkFromChainId(8895, 'test')
    await db.setNetworkName({ networkId: network.networkId, name: 'Real Name' })

    await db.setNetworkName({ networkId: network.networkId, name: '   ' })
    assert.strictEqual(await nameOf(network.networkId), 'Real Name')

    await db.setNetworkName({ networkId: network.networkId, name: null })
    assert.strictEqual(await nameOf(network.networkId), 'Real Name')

    await db.setNetworkName({ networkId: network.networkId, name: undefined })
    assert.strictEqual(await nameOf(network.networkId), 'Real Name')
  })
})
