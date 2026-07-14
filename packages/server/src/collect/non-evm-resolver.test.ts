import { describe, it, expect } from 'vitest'
import { registeredCoinTypes, type RegisteredCoinType } from 'slip44'
import { resolveChains, NAMESPACE_BY_COIN_TYPE, type CatalogEntry } from './non-evm-resolver'
import { NON_EVM_NAMESPACES } from '../chain-id'

const catalog: CatalogEntry[] = [
  { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
  { name: 'Monero', symbol: 'XMR', slug: 'monero', img_url: 'https://h/32/monero.png' },
  { name: 'Ripple', symbol: 'XRP', slug: 'xrp', img_url: 'https://h/32/xrp.png' },
  { name: 'Tezos', symbol: 'XTZ', slug: 'tezos', img_url: 'https://h/32/tezos.png' },
]

const coinTypes: RegisteredCoinType[] = [
  [0, 2147483648, 'BTC', 'Bitcoin'],
  [1, 2147483649, undefined, 'Testnet (all coins)'],
  [60, 2147483708, 'ETH', 'Ether'],
  [128, 2147483776, 'XMR', 'Monero'],
  [144, 2147483792, 'XRP', 'Ripple'],
  [175, 2147483823, 'RVN', 'Ravencoin'],
  [1729, 2147485377, 'XTZ', 'Tezos'],
  [999999, 3147483647, 'NOPE', 'No Icon Coin'],
]

describe('resolveChains', () => {
  it('applies curated namespaces for altar families and the coin type as reference', () => {
    const { resolved } = resolveChains(coinTypes, catalog)
    const byName = Object.fromEntries(resolved.map((r) => [r.name, r.identifier]))
    expect(byName['Bitcoin']).toBe('bip122-0')
    expect(byName['Monero']).toBe('monero-128')
    expect(byName['Ripple']).toBe('memo-144')
  })

  it('skips non-curated long-tail chains rather than storing them', () => {
    const { resolved, skipped } = resolveChains(coinTypes, catalog)
    expect(resolved.find((r) => r.name === 'Tezos')).toBeUndefined()
    expect(skipped.find((s) => s.name === 'Tezos')!.reason).toBe('not-curated')
  })

  it('upscales the icon url', () => {
    const { resolved } = resolveChains(coinTypes, catalog)
    expect(resolved.find((r) => r.name === 'Bitcoin')!.imageUrl).toBe('https://h/128/bitcoin.png')
  })

  it('pins the icon by slug, never by ticker symbol, so a same-symbol impostor cannot win', () => {
    // This is the whole reason the resolver pins slugs. A meme/wrapped token can
    // share a chain's ticker and, when it sorts earlier in the catalog, would win
    // a symbol-first match. Here two decoys with Bitcoin's BTC ticker precede the
    // real 'bitcoin' entry; the pinned slug must still resolve to Bitcoin. If
    // anyone reintroduces symbol matching, this test fails.
    const decoyCatalog: CatalogEntry[] = [
      { name: 'Wrapped BTC Impostor', symbol: 'BTC', slug: 'wbtc-impostor', img_url: 'https://h/32/wbtc-impostor.png' },
      { name: 'BTC Meme', symbol: 'BTC', slug: 'btc-meme', img_url: 'https://h/32/btc-meme.png' },
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
    ]
    const { resolved } = resolveChains([[0, 2147483648, 'BTC', 'Bitcoin']], decoyCatalog)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].imageUrl).toBe('https://h/128/bitcoin.png')
  })

  it('resolves the Sui flagship to its own namespace, coin type, and pinned icon', () => {
    const suiCatalog: CatalogEntry[] = [
      // A same-ticker impostor sorted first, to prove the pin (not the symbol) wins.
      { name: 'GOATs of Sui', symbol: 'SUI', slug: 'goats-of-sui', img_url: 'https://h/32/goats-of-sui.png' },
      { name: 'Sui', symbol: 'SUI', slug: 'sui', img_url: 'https://h/32/sui.png' },
    ]
    const { resolved } = resolveChains([[784, 2147484432, 'SUI', 'Sui']], suiCatalog)
    expect(resolved).toEqual([
      { identifier: 'sui-784', namespace: 'sui', reference: 784, name: 'Sui', imageUrl: 'https://h/128/sui.png' },
    ])
  })

  it('pins Polkadot to its real catalog slug even though the obvious slug and ticker are decoys', () => {
    // Polkadot has no bare 'polkadot' slug — the real chain is 'polkadot-new' —
    // and its DOT ticker is shared by a meme token. A symbol match or a guess at
    // the 'polkadot' slug would both miss; only the explicit pin resolves it.
    const dotCatalog: CatalogEntry[] = [
      { name: 'Dogs Of Toly', symbol: 'DOT', slug: 'dogs-of-toly', img_url: 'https://h/32/dogs-of-toly.png' },
      { name: 'Polkadot', symbol: 'DOT', slug: 'polkadot-new', img_url: 'https://h/32/polkadot-new.png' },
    ]
    const { resolved } = resolveChains([[354, 2147484002, 'DOT', 'Polkadot']], dotCatalog)
    expect(resolved).toEqual([
      {
        identifier: 'polkadot-354',
        namespace: 'polkadot',
        reference: 354,
        name: 'Polkadot',
        imageUrl: 'https://h/128/polkadot-new.png',
      },
    ])
  })

  it('fails safe (no-icon) when a pinned slug is absent from the catalog', () => {
    // Ravencoin is curated (bip122, pinned to 'ravencoin') but the fixture catalog
    // has no 'ravencoin' slug, so it must be skipped as 'no-icon' rather than
    // falling back to some wrong entry.
    const { resolved, skipped } = resolveChains(coinTypes, catalog)
    expect(resolved.find((r) => r.name === 'Ravencoin')).toBeUndefined()
    expect(skipped.find((s) => s.name === 'Ravencoin')!.reason).toBe('no-icon')
  })

  it('skips and records reserved-Ethereum and non-curated coins', () => {
    const { skipped } = resolveChains(coinTypes, catalog)
    const byReason = Object.fromEntries(skipped.map((s) => [s.name, s.reason]))
    expect(byReason['Ether']).toBe('reserved-evm')
    expect(byReason['No Icon Coin']).toBe('not-curated')
    // A symbol-less registry entry that is not curated is simply not curated —
    // the resolver no longer consults ticker symbols at all.
    expect(byReason['Testnet (all coins)']).toBe('not-curated')
  })

  it('curates only real Satoshi-Labs-Improvement-Proposal-44 coin types', () => {
    // Every curated coin type must exist in the real registry, otherwise the
    // chain silently never resolves (the reference is matched against the
    // registry, not invented). This guards against derivation-purpose values
    // like Cardano's 1852 being mistaken for its coin type (1815).
    const registered = new Set(registeredCoinTypes.map(([reference]) => reference))
    for (const reference of Object.keys(NAMESPACE_BY_COIN_TYPE).map(Number)) {
      expect(registered.has(reference), `coin type ${reference} is not a registered SLIP-44 chain`).toBe(true)
    }
  })

  it('curates only namespaces the chain-id layer treats as non-Ethereum-Virtual-Machine', () => {
    // Every curated namespace must be in the closed NON_EVM_NAMESPACES set,
    // otherwise namespaceToNetworkType would map the stored network.type to
    // 'evm' at lookup time -- the network_id hash would not reproduce and the
    // logo would be silently unservable.
    for (const { namespace } of Object.values(NAMESPACE_BY_COIN_TYPE)) {
      expect(NON_EVM_NAMESPACES.has(namespace), `namespace ${namespace} is not in NON_EVM_NAMESPACES`).toBe(true)
    }
  })

  it('pins every curated chain to a non-empty slug or an explicit icon url', () => {
    // A structural guard so a future addition cannot forget the pin and silently
    // fall back to no icon (or, worse, reintroduce ambiguous matching).
    for (const [reference, chain] of Object.entries(NAMESPACE_BY_COIN_TYPE)) {
      const hasSource = (typeof chain.iconSlug === 'string' && chain.iconSlug.length > 0) || Boolean(chain.iconUrl)
      expect(hasSource, `coin type ${reference} has no iconSlug or iconUrl`).toBe(true)
    }
  })
})
