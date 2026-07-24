import { describe, expect, it, vi } from 'vitest'

// The collector chain (collectables -> many collectors -> ../utils) instantiates
// the Ink terminal renderer at module load, which cannot run under vitest. An
// endlessly-chainable no-op stands in — same pattern as
// src/utils/chain-id-to-network-id.test.ts.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

// buildCollectables() only reads `.id` off each chain, lazily, well after
// construction (inside discover()/collect(), which this test never calls) — a
// minimal stand-in is enough, and it avoids collectables.ts pulling in the real
// chains() -> args/collect() -> live yargs parse of the test runner's argv.
const fakeChain = (id: number) => ({ id }) as any
vi.mock('../chains', () => ({
  default: () => ({
    mainnet: fakeChain(1),
    pulsechain: fakeChain(369),
    bsc: fakeChain(56),
    sepolia: fakeChain(11155111),
    pulsechainV4: fakeChain(943),
  }),
}))

import { allCollectables, collectables } from './collectables'
import { collectableOrder } from './collectable-order'

describe('collectables', () => {
  it('builds an instance for every declared collectable key, keyed by that key', () => {
    const built = collectables()

    // `key` is stamped by each collector for ranking derivation (sync-order.ts);
    // a mismatch here would silently misfile that collector's rankings under
    // the wrong provider.
    for (const [registryKey, instance] of Object.entries(built)) {
      expect(instance, `${registryKey} is missing from the registry`).toBeDefined()
      expect(typeof instance.discover, `${registryKey}.discover must be a function`).toBe('function')
      expect(typeof instance.collect, `${registryKey}.collect must be a function`).toBe('function')
    }
  })

  it('matches collectable-order.ts key for key, in the same order', () => {
    // collectable-order.ts holds a second copy of this ordering so the database layer
    // can rank a provider without importing every collector — importing the registry
    // there would be circular, since every collector imports the database layer.
    // The copy drifting is silent in production: a collector missing from that list
    // ranks last, so it would quietly stop being able to claim a network icon from a
    // lower-priority source. This is what makes the drift loud.
    expect(Object.keys(collectables())).toEqual([...collectableOrder])
  })

  it('is memoized, so the same collector instances are reused across calls', () => {
    const first = collectables()
    const second = collectables()

    expect(second).toBe(first)
    expect(second.gibs).toBe(first.gibs)
  })
})

describe('allCollectables', () => {
  it('lists exactly the keys collectables() built, in registry order', () => {
    // This is the ordering sync-order.ts turns into image-priority rankings —
    // a key present in one but not the other would either rank nothing for a
    // real collector or crash resolving a ranking for one that does not exist.
    expect(allCollectables()).toEqual(Object.keys(collectables()))
  })

  it('includes the documented priority anchors in their documented relative order', () => {
    const order = allCollectables()
    // smoldapp must outrank internetmoney (comment: "so it must outrank
    // providers that serve bridged/provenance-styled art"), and chainlist is
    // the deliberately-last broadest fallback.
    expect(order.indexOf('smoldapp')).toBeLessThan(order.indexOf('internetmoney'))
    expect(order.indexOf('chainlist')).toBe(order.length - 1)
  })
})
