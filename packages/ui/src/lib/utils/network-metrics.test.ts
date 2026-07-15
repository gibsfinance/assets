import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../types'
import { countSupportedNetworks } from './network-metrics'

/**
 * countSupportedNetworks now reads NetworkInfo.name, which useMetrics has already
 * resolved through getNetworkName. That makes the fixture's own `name` the thing under
 * test, so these no longer have to derive a chain the vendored registry snapshot
 * happens to call a testnet — a coupling that broke once already when upstream renamed
 * chain 9 from "Ubiq Network Testnet" to "Quai Network Mainnet".
 */
const network = (over: Partial<NetworkInfo>): NetworkInfo => ({
  name: 'Ethereum',
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
      network({ name: 'Bitcoin', chainId: 0, chainIdentifier: 'bip122-0', type: 'bip122', isEvm: false, hasImage: true }),
      // neither tokens nor logo -> excluded
      network({ name: 'Ghost', chainId: 999999, chainIdentifier: 'eip155-999999' }),
      // testnet -> excluded despite qualifying on both counts
      network({ name: 'Sepolia Testnet', chainId: 11155111, chainIdentifier: 'eip155-11155111', tokenCount: 5, hasImage: true }),
    ]
    expect(countSupportedNetworks(nets)).toBe(2)
  })

  it('matches the testnet name case-insensitively', () => {
    const nets = [network({ name: 'Some TESTNET Chain', tokenCount: 5, hasImage: true })]
    expect(countSupportedNetworks(nets)).toBe(0)
  })

  // Documents the known undercount rather than asserting it is correct: the registry
  // ships no testnet flag, so a testnet not named like one is counted as a mainnet.
  // If a real signal ever replaces the substring match, this is the test to delete.
  it('counts a testnet whose name omits the word — the known limitation', () => {
    const nets = [network({ name: 'Goerli', chainId: 5, chainIdentifier: 'eip155-5', tokenCount: 5, hasImage: true })]
    expect(countSupportedNetworks(nets)).toBe(1)
  })
})
