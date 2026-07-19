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
  await t.test('it round-trips stored naming through the public mapping', async () => {
    const network = await db.insertNetworkFromChainId(8891, 'test')
    await db.setNetworkNaming({
      networkId: network.networkId,
      name: 'Round Trip Chain',
      title: 'Round Trip Testnet Chain',
    })

    const stored = (await db.getNetworks()).find((n) => n.networkId === network.networkId)
    assert.ok(stored, 'the seeded network should be stored')
    assert.strictEqual(toPublicNetwork(stored).name, 'Round Trip Chain')
    assert.strictEqual(toPublicNetwork(stored).title, 'Round Trip Testnet Chain')
  })

  // A network no collector ever named must still serve, carrying explicit nulls so the
  // client knows to fall back rather than render an empty label.
  await t.test('it maps a network nobody named to null naming', async () => {
    const network = await db.insertNetworkFromChainId(8892, 'test')

    const stored = (await db.getNetworks()).find((n) => n.networkId === network.networkId)
    assert.ok(stored, 'the seeded network should be stored')
    assert.strictEqual(toPublicNetwork(stored).name, null)
    assert.strictEqual(toPublicNetwork(stored).title, null)
  })
})

test('setNetworkNaming', { skip: !(await isDbAvailable()) && 'no database connection' }, async (t) => {
  t.beforeEach(async () => testUtils.setup())
  t.afterEach(async () => testUtils.teardown())

  const namingOf = async (networkId: string) => {
    const networks = await db.getNetworks()
    const found = networks.find((n) => n.networkId === networkId)
    return { name: found?.name, title: found?.title }
  }

  await t.test('it stores trimmed values', async () => {
    const network = await db.insertNetworkFromChainId(8893, 'test')
    await db.setNetworkNaming({ networkId: network.networkId, name: '  Padded Chain  ', title: '  Padded Title  ' })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Padded Chain', title: 'Padded Title' })
  })

  await t.test('it overwrites earlier values so a rename upstream lands', async () => {
    const network = await db.insertNetworkFromChainId(8894, 'test')
    await db.setNetworkNaming({ networkId: network.networkId, name: 'Old Name', title: 'Old Title' })
    await db.setNetworkNaming({ networkId: network.networkId, name: 'New Name', title: 'New Title' })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'New Name', title: 'New Title' })
  })

  /**
   * A blank value must not overwrite a good one. The registry ships nameless chains, so
   * without this guard a single malformed entry would blank a label that a previous
   * run had recorded correctly — and an empty string reads as a real value downstream,
   * suppressing the fallback and rendering nothing at all.
   */
  await t.test('it leaves existing values alone when handed blank or missing ones', async () => {
    const network = await db.insertNetworkFromChainId(8895, 'test')
    await db.setNetworkNaming({ networkId: network.networkId, name: 'Real Name', title: 'Real Title' })

    await db.setNetworkNaming({ networkId: network.networkId, name: '   ', title: '   ' })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Real Name', title: 'Real Title' })

    await db.setNetworkNaming({ networkId: network.networkId, name: null, title: null })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Real Name', title: 'Real Title' })

    await db.setNetworkNaming({ networkId: network.networkId })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Real Name', title: 'Real Title' })
  })

  /**
   * Most registry chains ship a name and no title. Writing the name must not blank a
   * title, and each field has to be skippable on its own — a single shared guard would
   * drop the name whenever the title was absent.
   */
  await t.test('it writes each field independently', async () => {
    const network = await db.insertNetworkFromChainId(8896, 'test')

    await db.setNetworkNaming({ networkId: network.networkId, name: 'Name Only' })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Name Only', title: null })

    await db.setNetworkNaming({ networkId: network.networkId, title: 'Title Only' })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Name Only', title: 'Title Only' })

    await db.setNetworkNaming({ networkId: network.networkId, name: 'Renamed', title: '  ' })
    assert.deepStrictEqual(await namingOf(network.networkId), { name: 'Renamed', title: 'Title Only' })
  })
})
