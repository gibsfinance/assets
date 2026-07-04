import { describe, it, expect } from 'vitest'
import { resolveChains, slugify, type CatalogEntry } from './non-evm-resolver'
import type { RegisteredCoinType } from 'slip44'

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
  [1729, 2147485377, 'XTZ', 'Tezos'],
  [999999, 3147483647, 'NOPE', 'No Icon Coin'],
]

describe('resolveChains', () => {
  it('slugifies names for the default namespace', () => {
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

  it('gives long-tail chains their own slug namespace', () => {
    const { resolved } = resolveChains(coinTypes, catalog)
    const tezos = resolved.find((r) => r.name === 'Tezos')!
    expect(tezos.identifier).toBe('tezos-1729')
    expect(tezos.namespace).toBe('tezos')
  })

  it('upscales the icon url', () => {
    const { resolved } = resolveChains(coinTypes, catalog)
    expect(resolved.find((r) => r.name === 'Bitcoin')!.imageUrl).toBe('https://h/128/bitcoin.png')
  })

  it('skips and records symbol-less, Ethereum, and iconless coins', () => {
    const { skipped } = resolveChains(coinTypes, catalog)
    const byReason = Object.fromEntries(skipped.map((s) => [s.name, s.reason]))
    expect(byReason['Testnet (all coins)']).toBe('no-symbol')
    expect(byReason['Ether']).toBe('reserved-evm')
    expect(byReason['No Icon Coin']).toBe('no-icon')
  })
})
