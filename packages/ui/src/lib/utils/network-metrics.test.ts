import { describe, expect, it } from 'vitest'
import type { NetworkInfo } from '../types'
import { countSupportedNetworks } from './network-metrics'

describe('countSupportedNetworks', () => {
  it('counts chains with tokens or a logo, excluding testnets', () => {
    const nets = [
      {
        name: 'Ethereum',
        tokenCount: 100,
        hasImage: true,
        chainId: 1,
        chainIdentifier: 'eip155-1',
        type: 'evm',
        isEvm: true,
      },
      {
        name: 'Bitcoin',
        tokenCount: 0,
        hasImage: true,
        chainId: 0,
        chainIdentifier: 'bip122-0',
        type: 'bip122',
        isEvm: false,
      }, // logo-only -> counts
      {
        name: 'Ghost',
        tokenCount: 0,
        hasImage: false,
        chainId: 999999,
        chainIdentifier: 'eip155-999999',
        type: 'evm',
        isEvm: true,
      }, // neither -> excluded
      {
        name: 'Sepolia Testnet',
        tokenCount: 5,
        hasImage: true,
        chainId: 9,
        chainIdentifier: 'eip155-9',
        type: 'evm',
        isEvm: true,
      }, // testnet -> excluded
    ] as NetworkInfo[]
    expect(countSupportedNetworks(nets)).toBe(2)
  })
})
