import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../types'
import { sortNetworks, PRIORITY_CHAIN_IDS } from './network-sort'

/**
 * Builds a network fixture with sane defaults so each test names only the
 * fields the claim depends on.
 */
const network = (over: Partial<NetworkInfo>): NetworkInfo => ({
  chainId: 1,
  chainIdentifier: 'eip155-1',
  type: 'evm',
  name: 'Ethereum',
  isTestnet: false,
  tokenCount: 0,
  hasImage: false,
  isEvm: true,
  ...over,
})

describe('sortNetworks', () => {
  it('returns an empty result for an empty input', () => {
    expect(sortNetworks([], { showTestnets: false })).toEqual([])
  })

  it('puts the pinned chains first, in the order the priority list names them', () => {
    const other = network({ chainId: 999, chainIdentifier: 'eip155-999', name: 'Zeta' })
    const ethereum = network({ chainId: 1, chainIdentifier: 'eip155-1', name: 'Ethereum' })
    const pulsechain = network({ chainId: 369, chainIdentifier: 'eip155-369', name: 'PulseChain' })

    const result = sortNetworks([other, ethereum, pulsechain], { showTestnets: false })

    expect(result.map((entry) => entry.chainId)).toEqual([1, 369, 999])
  })

  it('keeps the priority order even when the pinned chains arrive reversed', () => {
    const pulsechain = network({ chainId: 369, chainIdentifier: 'eip155-369', name: 'PulseChain' })
    const ethereum = network({ chainId: 1, chainIdentifier: 'eip155-1', name: 'Ethereum' })

    const result = sortNetworks([pulsechain, ethereum], { showTestnets: false })

    // PRIORITY_CHAIN_IDS lists Ethereum before PulseChain, so the input order
    // must not decide the result — the priority list does.
    expect(result.map((entry) => entry.chainId.toString())).toEqual([...PRIORITY_CHAIN_IDS])
  })

  it('sorts unpinned networks by name, case-insensitively like localeCompare', () => {
    const banana = network({ chainId: 10, chainIdentifier: 'eip155-10', name: 'Banana' })
    const apple = network({ chainId: 20, chainIdentifier: 'eip155-20', name: 'apple' })

    const result = sortNetworks([banana, apple], { showTestnets: false })

    // A plain < comparison puts capital-letter names before lowercase ones,
    // so "Banana" would beat "apple" under it. localeCompare orders by letter
    // instead, so "apple" comes first.
    expect(result.map((entry) => entry.name)).toEqual(['apple', 'Banana'])
  })

  it('ranks a pinned chain above an unpinned one that sorts earlier by name', () => {
    const alpha = network({ chainId: 20, chainIdentifier: 'eip155-20', name: 'Alpha' })
    const ethereum = network({ chainId: 1, chainIdentifier: 'eip155-1', name: 'Ethereum' })

    const result = sortNetworks([alpha, ethereum], { showTestnets: false })

    expect(result.map((entry) => entry.name)).toEqual(['Ethereum', 'Alpha'])
  })

  it('ranks a pinned chain above an unpinned one when the pinned entry is compared first', () => {
    // The two-entry case above and this one exercise the comparator with the
    // pinned and unpinned network passed in each of the two possible roles,
    // so both the "pinned first" and "unpinned first" comparisons are proven.
    const alpha = network({ chainId: 20, chainIdentifier: 'eip155-20', name: 'Alpha' })
    const ethereum = network({ chainId: 1, chainIdentifier: 'eip155-1', name: 'Ethereum' })

    const result = sortNetworks([ethereum, alpha], { showTestnets: false })

    expect(result.map((entry) => entry.name)).toEqual(['Ethereum', 'Alpha'])
  })

  it('drops testnets when showTestnets is false', () => {
    const mainnet = network({ chainId: 5000, chainIdentifier: 'eip155-5000', name: 'Mainnet' })
    const testnet = network({
      chainId: 5001,
      chainIdentifier: 'eip155-5001',
      name: 'Testnet',
      isTestnet: true,
    })

    const result = sortNetworks([mainnet, testnet], { showTestnets: false })

    expect(result.map((entry) => entry.name)).toEqual(['Mainnet'])
  })

  it('keeps testnets when showTestnets is true', () => {
    const mainnet = network({ chainId: 5000, chainIdentifier: 'eip155-5000', name: 'Mainnet' })
    const testnet = network({
      chainId: 5001,
      chainIdentifier: 'eip155-5001',
      name: 'Testnet',
      isTestnet: true,
    })

    const result = sortNetworks([mainnet, testnet], { showTestnets: true })

    expect(result.map((entry) => entry.name)).toEqual(['Mainnet', 'Testnet'])
  })

  it('does not modify the input array, which the caller may still hold', () => {
    const zeta = network({ chainId: 30, chainIdentifier: 'eip155-30', name: 'Zeta' })
    const alpha = network({ chainId: 40, chainIdentifier: 'eip155-40', name: 'Alpha' })
    const input = [zeta, alpha]

    sortNetworks(input, { showTestnets: false })

    expect(input).toEqual([zeta, alpha])
  })

  it('does not modify the input array when showTestnets is true, where no filter runs first', () => {
    // With showTestnets false, filter() already returns a fresh array, so
    // that test above cannot tell a copy from an in-place sort. With
    // showTestnets true, nothing filters the input first, so the source
    // must copy on its own — this is the case the deliberate spread covers.
    const zeta = network({ chainId: 30, chainIdentifier: 'eip155-30', name: 'Zeta' })
    const alpha = network({ chainId: 40, chainIdentifier: 'eip155-40', name: 'Alpha' })
    const input = [zeta, alpha]

    sortNetworks(input, { showTestnets: true })

    expect(input).toEqual([zeta, alpha])
  })

  it('matches a numeric chain id against the priority list via its string form', () => {
    const ethereum = network({ chainId: 1, chainIdentifier: 'eip155-1', name: 'Ethereum' })
    const other = network({ chainId: 500, chainIdentifier: 'eip155-500', name: 'Alpha' })

    const result = sortNetworks([other, ethereum], { showTestnets: false })

    expect(result[0].chainId).toBe(1)
  })

  it('matches a chain id given as the string "1", because real data carries both shapes', () => {
    const ethereumAsString = network({
      // Real NetworkInfo values are typed as number, but upstream data has
      // carried string chain ids — the source calls toString() to cover both.
      chainId: '1' as unknown as number,
      chainIdentifier: 'eip155-1',
      name: 'Ethereum',
    })
    const other = network({ chainId: 500, chainIdentifier: 'eip155-500', name: 'Alpha' })

    const result = sortNetworks([other, ethereumAsString], { showTestnets: false })

    expect(result[0].name).toBe('Ethereum')
  })
})
