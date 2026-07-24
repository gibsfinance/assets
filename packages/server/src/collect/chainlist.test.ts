import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import { parseChains, pickIconUrl } from './chainlist-parse'
import chainlist, { collect } from './chainlist'

describe('parseChains', () => {
  it('keeps only chains with a positive integer chainId and a non-empty icon key', () => {
    const raw = [
      { chainId: 1, name: 'Ethereum Mainnet', icon: 'ethereum' },
      { chainId: 137, name: 'Polygon', icon: 'polygon' },
      { chainId: 250, name: 'Fantom' }, // no icon -> dropped
      { chainId: 0, name: 'Zero', icon: 'zero' }, // non-positive -> dropped
      { chainId: 1.5, name: 'Frac', icon: 'frac' }, // non-integer -> dropped
      { chainId: '8453', name: 'Base', icon: 'base' }, // string chainId -> dropped
      { name: 'No id', icon: 'x' }, // missing chainId -> dropped
      { chainId: 100, name: 'Gnosis', icon: '' }, // empty icon -> dropped
    ]
    expect(parseChains(raw)).toEqual([
      { chainId: 1, icon: 'ethereum', name: 'Ethereum Mainnet', title: undefined },
      { chainId: 137, icon: 'polygon', name: 'Polygon', title: undefined },
    ])
  })

  it('dedupes by chainId, keeping the first occurrence', () => {
    const raw = [
      { chainId: 1, name: 'Ethereum', icon: 'ethereum' },
      { chainId: 1, name: 'Ethereum dup', icon: 'other' },
    ]
    expect(parseChains(raw)).toEqual([{ chainId: 1, icon: 'ethereum', name: 'Ethereum', title: undefined }])
  })

  it('tolerates non-array and junk input', () => {
    expect(parseChains(null)).toEqual([])
    expect(parseChains({})).toEqual([])
    expect(parseChains([null, 42, 'nope', {}])).toEqual([])
  })

  /**
   * The name rides along with the icon so the two cannot drift, but the icon is what
   * this collector exists for — a chain must still be collected when upstream has no
   * usable name, leaving the label to the client's fallback map.
   */
  describe('name', () => {
    it('keeps an icon-bearing chain whose name is missing, null, or blank', () => {
      const raw = [
        { chainId: 704851, name: null, icon: 'nameless' },
        { chainId: 2, icon: 'absent' },
        { chainId: 3, name: '   ', icon: 'blank' },
      ]
      expect(parseChains(raw)).toEqual([
        { chainId: 704851, icon: 'nameless', name: undefined, title: undefined },
        { chainId: 2, icon: 'absent', name: undefined, title: undefined },
        { chainId: 3, icon: 'blank', name: undefined, title: undefined },
      ])
    })

    it('trims a padded name', () => {
      expect(parseChains([{ chainId: 1, name: '  Ethereum Mainnet  ', icon: 'ethereum' }])).toEqual([
        { chainId: 1, icon: 'ethereum', name: 'Ethereum Mainnet', title: undefined },
      ])
    })

    it('ignores a name that is not a string', () => {
      expect(parseChains([{ chainId: 1, name: 42, icon: 'ethereum' }])).toEqual([
        { chainId: 1, icon: 'ethereum', name: undefined, title: undefined },
      ])
    })
  })

  /**
   * The registry ships a title on only ~11% of chains, but it is the one place a
   * testnet named after a codename says what it is, so it has to survive parsing.
   */
  describe('title', () => {
    it('keeps the registry title when present', () => {
      expect(
        parseChains([{ chainId: 2017, name: 'Adiri', title: 'Telcoin Network Testnet', icon: 'telcoin' }]),
      ).toEqual([{ chainId: 2017, icon: 'telcoin', name: 'Adiri', title: 'Telcoin Network Testnet' }])
    })

    it('trims a padded title and drops a blank one', () => {
      expect(parseChains([{ chainId: 1, name: 'A', title: '  Padded  ', icon: 'i' }])[0].title).toBe('Padded')
      expect(parseChains([{ chainId: 1, name: 'A', title: '   ', icon: 'i' }])[0].title).toBeUndefined()
      expect(parseChains([{ chainId: 1, name: 'A', title: null, icon: 'i' }])[0].title).toBeUndefined()
      expect(parseChains([{ chainId: 1, name: 'A', title: 42, icon: 'i' }])[0].title).toBeUndefined()
    })
  })
})

describe('pickIconUrl', () => {
  it('returns the first descriptor url (an ipfs uri)', () => {
    const raw = [
      { url: 'ipfs://QmdwQDr6vmBtXmK2TmknkEuZNoaDqTasFdZdu3DRw8b2wt', width: 1000, height: 1628, format: 'png' },
    ]
    expect(pickIconUrl(raw)).toBe('ipfs://QmdwQDr6vmBtXmK2TmknkEuZNoaDqTasFdZdu3DRw8b2wt')
  })

  it('accepts an https url too', () => {
    expect(pickIconUrl([{ url: 'https://example.com/logo.png' }])).toBe('https://example.com/logo.png')
  })

  it('returns null for empty, malformed, or urlless descriptors', () => {
    expect(pickIconUrl([])).toBeNull()
    expect(pickIconUrl(null)).toBeNull()
    expect(pickIconUrl([{ width: 10 }])).toBeNull()
    expect(pickIconUrl([{ url: '' }])).toBeNull()
    expect(pickIconUrl([{ url: 42 }])).toBeNull()
  })
})

const CHAINS_URL = 'https://chainid.network/chains.json'
const ICON_META_BASE = 'https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/icons'

describe('chainlist collector', () => {
  it('registers the provider with no token lists during discover()', async () => {
    const manifest = await chainlist.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['chainlist'])
    expect(manifest).toEqual([{ providerKey: 'chainlist', lists: [] }])
  })

  it('stores a network icon and naming for a chain with a resolvable icon', async () => {
    harness.queueFetchResponse(CHAINS_URL, {
      body: [{ chainId: 137, icon: 'polygon', name: 'polygon', title: 'Polygon Mainnet' }],
    })
    harness.queueFetchResponse(`${ICON_META_BASE}/polygon.json`, {
      body: [{ url: 'ipfs://polygon-icon-cid', width: 32, height: 32, format: 'png' }],
    })

    await chainlist.collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(1)
    expect(harness.state.networkImages[0]?.uri).toBe('ipfs://polygon-icon-cid')
    const network = [...harness.state.networks.values()].find((n) => n.chainId === 'eip155-137')
    expect(network?.name).toBe('polygon')
    expect(network?.title).toBe('Polygon Mainnet')
  })

  it('skips a chain whose icon key resolves to no url, without storing a network', async () => {
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 10, icon: 'missing-icon' }] })
    harness.queueFetchResponse(`${ICON_META_BASE}/missing-icon.json`, { body: [] })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('treats a failed icon-metadata fetch the same as a missing icon, without throwing', async () => {
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 25, icon: 'broken' }] })
    harness.queueFetchResponse(`${ICON_META_BASE}/broken.json`, { status: 500, ok: false })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('skips a chain whose icon-metadata fetch rejects outright, without throwing out of collect()', async () => {
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 42, icon: 'flaky' }] })
    harness.queueFetchResponse(`${ICON_META_BASE}/flaky.json`, new Error('network error'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('skips a Tron chain mis-numbered as eip155 (isFakedEvmReference) instead of throwing', async () => {
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 728126428, icon: 'tron' }] })
    harness.queueFetchResponse(`${ICON_META_BASE}/tron.json`, { body: [{ url: 'ipfs://tron-icon' }] })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('skips storing any chain once the signal is already aborted', async () => {
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 1, icon: 'ethereum' }] })
    const controller = new AbortController()
    controller.abort()

    await collect(controller.signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('does nothing when the chains.json fetch itself fails', async () => {
    harness.queueFetchResponse(CHAINS_URL, { status: 503, ok: false })

    await collect(new AbortController().signal)

    expect(harness.state.networks.size).toBe(0)
    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('caches the icon-metadata lookup across repeated collect() runs for the same icon key', async () => {
    const chainsBody = { body: [{ chainId: 1, icon: 'shared', name: 'ethereum' }] }
    harness.queueFetchResponse(CHAINS_URL, chainsBody)
    harness.queueFetchResponse(CHAINS_URL, chainsBody)
    harness.queueFetchResponse(`${ICON_META_BASE}/shared.json`, { body: [{ url: 'ipfs://shared-icon' }] })

    await collect(new AbortController().signal)
    await collect(new AbortController().signal)

    // One network image per run — the second run re-stores the (unchanged) icon.
    expect(harness.state.networkImages).toHaveLength(2)
    // chains.json is fetched fresh each run (2 calls); the icon metadata, keyed by
    // `chainlist-icon:shared` in `cachedJSON`, is fetched only once across both runs.
    expect(harness.fetchModule.fetch).toHaveBeenCalledTimes(3)
  })
})
