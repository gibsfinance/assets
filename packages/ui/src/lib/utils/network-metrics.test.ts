import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../types'
import { countSupportedNetworks } from './network-metrics'

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
