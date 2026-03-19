import { test } from 'node:test'
import assert from 'assert'
import type { DiscoveryManifest } from '../src/collect/base-collector'

import { computeRankings } from '../src/db/sync-order'

test('computeRankings', async (t) => {
  await t.test('assigns base ranking = position * 1000', () => {
    const collectableKeys = ['dexscreener', 'trustwallet', 'coingecko']
    const manifests = new Map<string, DiscoveryManifest>([
      ['dexscreener', [{ providerKey: 'dexscreener', lists: [{ listKey: 'api' }] }]],
      ['trustwallet', [{ providerKey: 'trustwallet', lists: [{ listKey: 'wallet' }] }]],
      ['coingecko', [{ providerKey: 'coingecko', lists: [{ listKey: 'ethereum' }] }]],
    ])

    const rankings = computeRankings(collectableKeys, manifests)

    assert.strictEqual(rankings.length, 3)
    assert.strictEqual(rankings[0].ranking, 0)
    assert.strictEqual(rankings[1].ranking, 1000)
    assert.strictEqual(rankings[2].ranking, 2000)
  })

  await t.test('sub-lists sort alphabetically within tier', () => {
    const collectableKeys = ['trustwallet']
    const manifests = new Map<string, DiscoveryManifest>([
      ['trustwallet', [{
        providerKey: 'trustwallet',
        lists: [
          { listKey: 'wallet-pulsechain' },
          { listKey: 'wallet-ethereum' },
          { listKey: 'wallet' },
        ],
      }]],
    ])

    const rankings = computeRankings(collectableKeys, manifests)

    assert.strictEqual(rankings.length, 3)
    assert.strictEqual(rankings[0].listKey, 'wallet')
    assert.strictEqual(rankings[0].ranking, 0)
    assert.strictEqual(rankings[1].listKey, 'wallet-ethereum')
    assert.strictEqual(rankings[1].ranking, 1)
    assert.strictEqual(rankings[2].listKey, 'wallet-pulsechain')
    assert.strictEqual(rankings[2].ranking, 2)
  })

  await t.test('dynamic providers get sub-rankings within parent tier', () => {
    const collectableKeys = ['uniswap-tokenlists']
    const manifests = new Map<string, DiscoveryManifest>([
      ['uniswap-tokenlists', [
        { providerKey: 'uniswap-compound', lists: [{ listKey: 'hosted' }] },
        { providerKey: 'uniswap-aave', lists: [{ listKey: 'hosted' }] },
      ]],
    ])

    const rankings = computeRankings(collectableKeys, manifests)

    assert.strictEqual(rankings.length, 2)
    assert.strictEqual(rankings[0].providerKey, 'uniswap-aave')
    assert.strictEqual(rankings[0].ranking, 0)
    assert.strictEqual(rankings[1].providerKey, 'uniswap-compound')
    assert.strictEqual(rankings[1].ranking, 1)
  })

  await t.test('skips collectables with no manifest entries', () => {
    const collectableKeys = ['missing', 'trustwallet']
    const manifests = new Map<string, DiscoveryManifest>([
      ['trustwallet', [{ providerKey: 'trustwallet', lists: [{ listKey: 'wallet' }] }]],
    ])

    const rankings = computeRankings(collectableKeys, manifests)

    assert.strictEqual(rankings.length, 1)
    assert.strictEqual(rankings[0].ranking, 1000) // position 1, not 0
  })
})
