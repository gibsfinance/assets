import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../types'
import { countSupportedNetworks, searchNetworks, scoreNetworkMatch, NETWORK_RELEVANCE } from './network-metrics'

/**
 * countSupportedNetworks reads the flags useMetrics already resolved, so a fixture's
 * own `isTestnet` is the thing under test here. The classification rule itself lives in
 * is-testnet.ts and is tested there.
 */
const network = (over: Partial<NetworkInfo>): NetworkInfo => ({
  name: 'Ethereum',
  isTestnet: false,
  tokenCount: 0,
  hasImage: false,
  chainId: 1,
  chainIdentifier: 'eip155-1',
  type: 'evm',
  isEvm: true,
  ...over,
})

describe('countSupportedNetworks', () => {
  it('counts chains with tokens or a logo, excluding testnets', () => {
    const nets = [
      network({ name: 'Ethereum', tokenCount: 100, hasImage: true }),
      // logo-only -> counts
      network({
        name: 'Bitcoin',
        chainId: 0,
        chainIdentifier: 'bip122-0',
        type: 'bip122',
        isEvm: false,
        hasImage: true,
      }),
      // neither tokens nor logo -> excluded
      network({ name: 'Ghost', chainId: 999999, chainIdentifier: 'eip155-999999' }),
      // testnet -> excluded despite qualifying on both counts
      network({
        name: 'Sepolia Testnet',
        isTestnet: true,
        chainId: 11155111,
        chainIdentifier: 'eip155-11155111',
        tokenCount: 5,
        hasImage: true,
      }),
    ]
    expect(countSupportedNetworks(nets)).toBe(2)
  })

  // A testnet is excluded on its resolved flag, not on how its name happens to read —
  // codename testnets like Goerli say nothing in the string.
  it('excludes a flagged testnet whose name never says testnet', () => {
    const nets = [
      network({
        name: 'Goerli',
        isTestnet: true,
        chainId: 5,
        chainIdentifier: 'eip155-5',
        tokenCount: 5,
        hasImage: true,
      }),
    ]
    expect(countSupportedNetworks(nets)).toBe(0)
  })

  // The inverse guard: the count must not sniff the name itself, or it would drift from
  // the drawer the moment the two disagreed.
  it('counts an unflagged chain even if its name reads like a testnet', () => {
    const nets = [network({ name: 'Wanchain Testnet', isTestnet: false, tokenCount: 5, hasImage: true })]
    expect(countSupportedNetworks(nets)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// searchNetworks / scoreNetworkMatch
// ---------------------------------------------------------------------------

/*
 * The drawer lists every supported network — over 1,900 — so the ordering of
 * matches is what makes it usable. Typing "eth" has to surface Ethereum, not
 * the first alphabetical chain whose name happens to contain those letters.
 */
describe('searchNetworks', () => {
  const ethereum = network({ name: 'Ethereum' })
  const ethereumClassic = network({ name: 'Ethereum Classic', chainId: 61, chainIdentifier: 'eip155-61' })
  const somethingElse = network({ name: 'Rootstock (Ethereum bridge)', chainId: 30, chainIdentifier: 'eip155-30' })
  const bitcoin = network({
    name: 'Bitcoin',
    chainId: 0,
    chainIdentifier: 'bip122-0',
    type: 'bip122',
    isEvm: false,
  })

  it('returns everything for an empty search', () => {
    expect(searchNetworks([ethereum, bitcoin], '')).toHaveLength(2)
    expect(searchNetworks([ethereum, bitcoin], '   ')).toHaveLength(2)
  })

  it('matches on name, case-insensitively', () => {
    expect(searchNetworks([ethereum, bitcoin], 'BITCOIN')).toEqual([bitcoin])
  })

  it('matches on the namespaced identifier', () => {
    expect(searchNetworks([ethereum, bitcoin], 'bip122')).toEqual([bitcoin])
  })

  // "1" is also a substring of "bip122-0", so both match. What matters is that
  // the chain whose number IS 1 wins — otherwise typing a chain id is useless.
  it('puts an exact chain-number match ahead of an incidental substring', () => {
    expect(searchNetworks([bitcoin, ethereum], '1')[0]).toBe(ethereum)
  })

  it('ranks a name that starts with the term above one that merely contains it', () => {
    const ranked = searchNetworks([somethingElse, ethereumClassic, ethereum], 'ethereum')
    expect(ranked[ranked.length - 1]).toBe(somethingElse)
    expect(ranked).toHaveLength(3)
  })

  // Ties keep the drawer's curated order — Ethereum, PulseChain, then alphabetical.
  it('leaves equally relevant networks in the order they arrived', () => {
    expect(searchNetworks([ethereum, ethereumClassic], 'ethereum')).toEqual([ethereum, ethereumClassic])
    expect(searchNetworks([ethereumClassic, ethereum], 'ethereum')).toEqual([ethereumClassic, ethereum])
  })

  it('returns nothing when no network matches', () => {
    expect(searchNetworks([ethereum, bitcoin], 'zzzz')).toHaveLength(0)
  })
})

describe('scoreNetworkMatch', () => {
  const ethereum = network({ name: 'Ethereum' })

  it.each([
    ['eip155-1', NETWORK_RELEVANCE.identifierExact],
    ['1', NETWORK_RELEVANCE.chainIdExact],
    ['ether', NETWORK_RELEVANCE.namePrefix],
    ['reum', NETWORK_RELEVANCE.nameContains],
    ['eip155', NETWORK_RELEVANCE.identifierContains],
    ['nothing', NETWORK_RELEVANCE.none],
  ])('scores %s as the expected tier', (term, expected) => {
    expect(scoreNetworkMatch(ethereum, term)).toBe(expected)
  })
})
