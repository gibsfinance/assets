import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import { mergeRegistries, isIconIdentifier, namesSameChain, pickIconUrl } from './chainlist-parse'
import chainlist, { collect } from './chainlist'

/**
 * Two registries describe these chains, and they do not always agree.
 * chainlist.org is current about which chain a number is; ethereum-lists is
 * where the icon files live and lags behind. The merge exists to take identity
 * from the first without ever letting the second's artwork contradict it.
 */
describe('isIconIdentifier', () => {
  it('accepts a bare slug, which is what names a file in the icons directory', () => {
    expect(isIconIdentifier('ethereum')).toBe(true)
    expect(isIconIdentifier('hyperliquid')).toBe(true)
  })

  it('rejects a whole web address, which some entries carry in the icon field', () => {
    // Pasting one into the icons path would fetch a nonsense location every run.
    expect(isIconIdentifier('https://www.woofswap.finance/image/tokens/gatelayer.png')).toBe(false)
  })

  it('rejects the text a stringified object leaves behind', () => {
    // chainlist.org really ships this. It is somebody's serialization escaping
    // into the feed, and it would otherwise be treated as an icon's name.
    expect(isIconIdentifier('[object Object]')).toBe(false)
  })

  it('rejects an empty or non-text value', () => {
    expect(isIconIdentifier('')).toBe(false)
    expect(isIconIdentifier(null)).toBe(false)
    expect(isIconIdentifier(42)).toBe(false)
  })
})

describe('namesSameChain', () => {
  it('reads a bare name and a Mainnet-suffixed one as one chain', () => {
    // Holding out for an exact match would throw away a good icon over a word.
    expect(namesSameChain('Ronin', 'Ronin Mainnet')).toBe(true)
    expect(namesSameChain('MegaETH', 'MegaETH Mainnet')).toBe(true)
  })

  it('separates two genuinely different chains sharing a number', () => {
    // This is the pair the whole merge exists for.
    expect(namesSameChain('HyperEVM', 'Wanchain Testnet')).toBe(false)
    expect(namesSameChain('ETHW-mainnet', 'Smart Bitcoin Cash Testnet')).toBe(false)
  })

  it('reads one name extending the other as the same chain said at two lengths', () => {
    // A real pair. Without this, fifteen chains would lose a good icon over a
    // word that both registries agree is decoration.
    expect(namesSameChain('XRPL EVM', 'XRPL EVM Sidechain')).toBe(true)
    expect(namesSameChain('SatoshiVM', 'SatoshiVM Alpha Mainnet')).toBe(true)
  })

  it('answers the same whichever name is given first', () => {
    // The rule is about two names describing one chain. Which registry was read
    // first is not part of that, and a rule that depended on it would give one
    // answer on the way in and another on the way back.
    expect(namesSameChain('XRPL EVM Sidechain', 'XRPL EVM')).toBe(true)
    expect(namesSameChain('Ronin Mainnet', 'Ronin')).toBe(true)
  })

  it('will not match on a name that normalizes down to a letter or two', () => {
    // "W Chain" normalizes to "w", which starts every name beginning with it.
    // A prefix that short is not evidence of anything.
    expect(namesSameChain('W Chain Mainnet', 'Wadzchain Mainnet')).toBe(false)
  })

  it('treats a missing name as no evidence of agreement', () => {
    expect(namesSameChain(undefined, 'Ethereum')).toBe(false)
    expect(namesSameChain('Ethereum', undefined)).toBe(false)
  })
})

describe('mergeRegistries', () => {
  it('takes the name from the authority when the two disagree', () => {
    // Chain 999 is the live case: Hyperliquid took the number, and the icon
    // registry still lists Wanchain's old testnet on it.
    const [entry] = mergeRegistries(
      [{ chainId: 999, name: 'HyperEVM', icon: 'hyperliquid' }],
      [{ chainId: 999, name: 'Wanchain Testnet', icon: 'wanchain' }],
    )
    expect(entry.name).toBe('HyperEVM')
  })

  it('withholds the other registry artwork when the two disagree about the chain', () => {
    // The failure this prevents is a network showing another network's logo,
    // which is worse than showing none: it reads as a fact rather than a gap.
    const [entry] = mergeRegistries(
      [{ chainId: 999, name: 'HyperEVM' }],
      [{ chainId: 999, name: 'Wanchain Testnet', icon: 'wanchain' }],
    )
    expect(entry.icon).toBeNull()
  })

  it('keeps a chain the registries disagree about even with no artwork to show', () => {
    // Its name is the thing that needs rewriting, precisely because the icon
    // beside it was withheld. Dropping the entry would leave the stale name.
    const entries = mergeRegistries(
      [{ chainId: 999, name: 'HyperEVM' }],
      [{ chainId: 999, name: 'Wanchain Testnet', icon: 'wanchain' }],
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ chainId: 999, name: 'HyperEVM', icon: null })
  })

  it('prefers the hosted artwork when the two agree about the chain', () => {
    // The icon files live in the second registry, so its identifier is the one
    // that resolves. Taking the authority's would lose icons on 159 chains.
    const [entry] = mergeRegistries(
      [{ chainId: 1, name: 'Ethereum', icon: 'eth-authority' }],
      [{ chainId: 1, name: 'Ethereum Mainnet', icon: 'ethereum' }],
    )
    expect(entry.icon).toBe('ethereum')
    expect(entry.name).toBe('Ethereum')
  })

  it('falls back to the authority artwork when the other registry has none', () => {
    const [entry] = mergeRegistries([{ chainId: 5000, name: 'Mantle', icon: 'mantle' }], [])
    expect(entry.icon).toBe('mantle')
  })

  it('leaves alone a chain with no artwork that neither registry disputes', () => {
    // This collector supplies network artwork. Creating rows for the thousand
    // chains that simply have none would be a different job done by accident.
    expect(mergeRegistries([{ chainId: 5000, name: 'Mantle' }], [{ chainId: 5000, name: 'Mantle' }])).toEqual([])
  })

  it('refuses a junk icon value from either registry rather than fetching it', () => {
    const [entry] = mergeRegistries(
      [{ chainId: 7, name: 'Seven', icon: '[object Object]' }],
      [{ chainId: 7, name: 'Seven', icon: 'https://example.test/logo.png' }],
    )
    expect(entry).toBeUndefined()
  })

  it('drops rows without a positive whole chain number', () => {
    const raw = [
      { chainId: 0, name: 'Zero', icon: 'zero' },
      { chainId: 1.5, name: 'Frac', icon: 'frac' },
      { chainId: '8453', name: 'Base', icon: 'base' },
      { name: 'No id', icon: 'x' },
    ]
    expect(mergeRegistries(raw, raw)).toEqual([])
  })

  it('keeps the first of a repeated chain number in either registry', () => {
    const [entry] = mergeRegistries(
      [
        { chainId: 1, name: 'Ethereum', icon: 'ethereum' },
        { chainId: 1, name: 'Ethereum duplicate', icon: 'other' },
      ],
      [],
    )
    expect(entry.name).toBe('Ethereum')
    expect(entry.icon).toBe('ethereum')
  })

  it('tolerates a registry that answers with something other than a list', () => {
    expect(mergeRegistries(null, null)).toEqual([])
    expect(mergeRegistries({}, 'nope')).toEqual([])
    expect(mergeRegistries([null, 42, 'nope', {}], [])).toEqual([])
  })

  it('reads a name from the other registry when the authority ships none', () => {
    // The registry really does carry nameless chains. A blank name is worse
    // than an absent one downstream, so an absent one stays absent.
    const [named] = mergeRegistries([{ chainId: 1, icon: 'ethereum' }], [{ chainId: 1, name: 'Ethereum Mainnet' }])
    expect(named.name).toBe('Ethereum Mainnet')

    const [nameless] = mergeRegistries([{ chainId: 1, icon: 'ethereum' }], [{ chainId: 1, name: '   ' }])
    expect(nameless.name).toBeUndefined()
  })

  it('carries the longer prose label, where a codename testnet says what it is', () => {
    const [entry] = mergeRegistries(
      [{ chainId: 2017, name: 'Adiri', title: 'Telcoin Network Testnet', icon: 'telcoin' }],
      [],
    )
    expect(entry.title).toBe('Telcoin Network Testnet')
    expect(mergeRegistries([{ chainId: 1, name: 'A', title: '   ', icon: 'i' }], [])[0].title).toBeUndefined()
    expect(mergeRegistries([{ chainId: 1, name: 'A', title: 42, icon: 'i' }], [])[0].title).toBeUndefined()
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

/** chainlist.org, the authority on which chain a number is. */
const AUTHORITY_URL = 'https://chainlist.org/rpcs.json'
/** ethereum-lists/chains, which hosts the icon files. */
const CHAINS_URL = 'https://chainid.network/chains.json'

/**
 * Queue both registries for one collect() run.
 *
 * The collector reads two. Queueing only one used to leave the other
 * unarranged, which the harness answers by throwing — and a run that cannot
 * reach its authority stops before it does anything, so a test could pass
 * while proving nothing about the behaviour it named.
 */
const queueRegistries = (chains: unknown[], iconRegistry: unknown[] = chains) => {
  harness.queueFetchResponse(AUTHORITY_URL, { body: chains })
  harness.queueFetchResponse(CHAINS_URL, { body: iconRegistry })
}
const ICON_META_BASE = 'https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/icons'

describe('chainlist collector', () => {
  it('registers the provider with no token lists during discover()', async () => {
    const manifest = await chainlist.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['chainlist'])
    expect(manifest).toEqual([{ providerKey: 'chainlist', lists: [] }])
  })

  it('stores a network icon and naming for a chain with a resolvable icon', async () => {
    queueRegistries([{ chainId: 137, icon: 'polygon', name: 'polygon', title: 'Polygon Mainnet' }])
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
    queueRegistries([{ chainId: 10, icon: 'missing-icon' }])
    harness.queueFetchResponse(`${ICON_META_BASE}/missing-icon.json`, { body: [] })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('treats a failed icon-metadata fetch the same as a missing icon, without throwing', async () => {
    queueRegistries([{ chainId: 25, icon: 'broken' }])
    harness.queueFetchResponse(`${ICON_META_BASE}/broken.json`, { status: 500, ok: false })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('skips a chain whose icon-metadata fetch rejects outright, without throwing out of collect()', async () => {
    queueRegistries([{ chainId: 42, icon: 'flaky' }])
    harness.queueFetchResponse(`${ICON_META_BASE}/flaky.json`, new Error('network error'))

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('skips a Tron chain mis-numbered as eip155 (isFakedEvmReference) instead of throwing', async () => {
    queueRegistries([{ chainId: 728126428, icon: 'tron' }])
    harness.queueFetchResponse(`${ICON_META_BASE}/tron.json`, { body: [{ url: 'ipfs://tron-icon' }] })

    await collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('skips storing any chain once the signal is already aborted', async () => {
    queueRegistries([{ chainId: 1, icon: 'ethereum' }])
    const controller = new AbortController()
    controller.abort()

    await collect(controller.signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.networks.size).toBe(0)
  })

  it('does nothing when the authoritative registry does not answer', async () => {
    // Without it the run cannot say which chain a number is, and writing names
    // from the lagging registry alone is what this change exists to stop.
    harness.queueFetchResponse(AUTHORITY_URL, { status: 503, ok: false })
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 1, icon: 'ethereum', name: 'Ethereum' }] })

    await collect(new AbortController().signal)

    expect(harness.state.networks.size).toBe(0)
    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('writes the corrected name and no picture when the registries disagree', async () => {
    // The case this whole arrangement exists for. chainlist.org says chain 999
    // is HyperEVM; the icon registry still calls it Wanchain Testnet and offers
    // Wanchain's logo. The name has to be rewritten and the logo has to be
    // refused — a network wearing another network's mark reads as a fact.
    harness.queueFetchResponse(AUTHORITY_URL, { body: [{ chainId: 999, name: 'HyperEVM' }] })
    harness.queueFetchResponse(CHAINS_URL, { body: [{ chainId: 999, name: 'Wanchain Testnet', icon: 'wanchain' }] })

    await collect(new AbortController().signal)

    const network = [...harness.state.networks.values()].find((n) => n.chainId === 'eip155-999')
    expect(network?.name).toBe('HyperEVM')
    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('survives a registry whose request rejects outright', async () => {
    // A refused connection is not a response with a status. Letting it throw
    // would take the whole collect run down with it.
    harness.queueFetchResponse(AUTHORITY_URL, new Error('network error'))
    harness.queueFetchResponse(CHAINS_URL, { body: [] })

    await expect(collect(new AbortController().signal)).resolves.toBeUndefined()
    expect(harness.state.networks.size).toBe(0)
  })

  it('carries on with fewer icons when only the icon registry fails', async () => {
    // Losing the artwork host costs icons. It must not cost the naming, which
    // comes from the registry that did answer.
    harness.queueFetchResponse(AUTHORITY_URL, { body: [{ chainId: 137, icon: 'polygon', name: 'Polygon' }] })
    harness.queueFetchResponse(CHAINS_URL, { status: 503, ok: false })
    harness.queueFetchResponse(`${ICON_META_BASE}/polygon.json`, { body: [{ url: 'ipfs://polygon-icon-cid' }] })

    await collect(new AbortController().signal)

    const network = [...harness.state.networks.values()].find((n) => n.chainId === 'eip155-137')
    expect(network?.name).toBe('Polygon')
  })

  it('caches the icon-metadata lookup across repeated collect() runs for the same icon key', async () => {
    const chains = [{ chainId: 1, icon: 'shared', name: 'ethereum' }]
    queueRegistries(chains)
    queueRegistries(chains)
    harness.queueFetchResponse(`${ICON_META_BASE}/shared.json`, { body: [{ url: 'ipfs://shared-icon' }] })

    await collect(new AbortController().signal)
    await collect(new AbortController().signal)

    // One network image per run — the second run re-stores the (unchanged) icon.
    expect(harness.state.networkImages).toHaveLength(2)
    // Both registries are fetched fresh each run (four calls). The icon metadata,
    // keyed by `chainlist-icon:shared` in `cachedJSON`, is fetched once across
    // both runs — five in total, not six.
    expect(harness.fetchModule.fetch).toHaveBeenCalledTimes(5)
  })
})
