import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import gibs, { collect } from './gibs'

describe('gibs collector', () => {
  it('registers the provider, the V4-testnet network, and the default list during discover()', async () => {
    const manifest = await gibs.discover(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['gibs'])
    expect(harness.state.lists.map((list) => list.key)).toEqual(['gibs'])
    expect(harness.state.networks.has('eip155-943')).toBe(true)
    expect(manifest).toEqual([{ providerKey: 'gibs', lists: [{ listKey: 'gibs' }] }])
  })

  it('stores the hardcoded V4 Pulse logo, read off disk, against the fixed token identity', async () => {
    await gibs.collect(new AbortController().signal)

    // This collector has no remote list or on-chain read to exercise: its whole
    // job is wiring one hardcoded token (V4 Pulse) to the image file harvested for
    // it. A regression here (wrong address, wrong network) would silently point a
    // real gib.show client at the wrong token, so every field is asserted.
    expect(harness.state.tokenImages).toHaveLength(1)
    const [image] = harness.state.tokenImages
    expect(image.token.providedId).toBe('0x70499adebb11efd915e3b69e700c331778628707')
    expect(image.token.symbol).toBe('V4PLS')
    expect(image.token.decimals).toBe(18)
    expect(image.token.networkId).toBe(harness.state.networks.get('eip155-943')?.networkId)
    // The image comes from the real harvested file, read at module load — proves
    // the collector hands the actual file bytes through rather than a placeholder.
    expect(Buffer.isBuffer(image.uri)).toBe(true)
    expect((image.uri as Buffer).length).toBeGreaterThan(0)
  })

  it('exposes a standalone collect() that delegates to the same collector instance', async () => {
    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['gibs'])
    expect(harness.state.tokenImages).toHaveLength(1)
  })
})
