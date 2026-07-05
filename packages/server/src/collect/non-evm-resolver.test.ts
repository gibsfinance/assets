import { describe, it, expect } from 'vitest'
import { registeredCoinTypes, type RegisteredCoinType } from 'slip44'
import { resolveChains, slugify, NAMESPACE_BY_COIN_TYPE, type CatalogEntry } from './non-evm-resolver'

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
  it('slugifies names for icon name matching', () => {
    expect(slugify('Bitcoin Cash')).toBe('bitcoin-cash')
    expect(slugify('Ether')).toBe('ether')
  })

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

  it('skips and records symbol-less, Ethereum, non-curated, and iconless coins', () => {
    const { skipped } = resolveChains(coinTypes, catalog)
    const byReason = Object.fromEntries(skipped.map((s) => [s.name, s.reason]))
    expect(byReason['Testnet (all coins)']).toBe('no-symbol')
    expect(byReason['Ether']).toBe('reserved-evm')
    expect(byReason['No Icon Coin']).toBe('not-curated')
    // Ravencoin is a curated bip122 family member with no matching catalog icon.
    expect(byReason['Ravencoin']).toBe('no-icon')
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
})
