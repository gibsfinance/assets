import { describe, it, expect, vi } from 'vitest'
// trustwallet imports ../utils, which instantiates the Ink terminal renderer at
// module load and cannot run under vitest. An endlessly-chainable no-op stands in.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import { NON_EVM_NETWORK_ARGS } from './trustwallet'
import { isValidChainId } from '../chain-id'
import { chainIdToNetworkId, toKeccakBytes } from '../utils'

/**
 * Trust Wallet stores the base58 token assets for Solana and Tron. Its numeric
 * chain-id map files them under EVM-looking references (900, 1000); these overrides
 * redirect the network insert to the real Satoshi-Labs-Improvement-Proposal-44
 * CAIP-2 identifiers so the tokens land on a servable, correctly-namespaced network.
 * A typo here would silently strand every non-EVM token, so lock the exact values.
 */
describe('Trust Wallet non-Ethereum-Virtual-Machine network overrides', () => {
  it('redirects solana and tron to their coin-type identifiers', () => {
    expect(NON_EVM_NETWORK_ARGS.solana).toEqual({ chainId: 'solana-501', type: 'solana' })
    expect(NON_EVM_NETWORK_ARGS.tron).toEqual({ chainId: 'tvm-195', type: 'tvm' })
  })

  it('every override is a servable identifier that hashes consistently', () => {
    for (const { chainId, type } of Object.values(NON_EVM_NETWORK_ARGS)) {
      expect(isValidChainId(chainId), `${chainId} must be a valid chain id`).toBe(true)
      const reference = chainId.split('-')[1]
      // insertNetworkFromChainId(chainId, type) → trigger keccak256(type || reference);
      // the serving path recomputes the same id from the CAIP-2 string alone.
      expect(chainIdToNetworkId(chainId, type)).toBe(toKeccakBytes(`${type}${reference}`))
      expect(chainIdToNetworkId(chainId)).toBe(toKeccakBytes(`${type}${reference}`))
    }
  })
})
