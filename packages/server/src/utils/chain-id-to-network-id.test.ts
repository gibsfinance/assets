import { describe, it, expect, vi } from 'vitest'
// src/utils instantiates the Ink terminal renderer at module load, which cannot
// run under vitest (patch-console). An endlessly-chainable no-op stands in.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import { chainIdToNetworkId, toKeccakBytes } from './index'

describe('chainIdToNetworkId', () => {
  it('keeps existing Ethereum-Virtual-Machine hashes byte-identical', () => {
    // Legacy behavior hashed 'evm' + bare reference. Lock it.
    expect(chainIdToNetworkId(369)).toBe(toKeccakBytes('evm369'))
    expect(chainIdToNetworkId('eip155-369')).toBe(toKeccakBytes('evm369'))
    expect(chainIdToNetworkId(369)).toBe(chainIdToNetworkId('eip155-369'))
  })

  it('keeps the asset-0 hash byte-identical (used by chainId 0 callers)', () => {
    expect(chainIdToNetworkId(0)).toBe(toKeccakBytes('evm0'))
    expect(chainIdToNetworkId('asset-0')).toBe(toKeccakBytes('evm0'))
  })

  it('hashes non-Ethereum-Virtual-Machine ids with the namespace as type', () => {
    // Must equal what the database trigger produces: keccak256(type || reference)
    // where type === namespace for these chains.
    expect(chainIdToNetworkId('bip122-0')).toBe(toKeccakBytes('bip1220'))
    expect(chainIdToNetworkId('monero-128')).toBe(toKeccakBytes('monero128'))
    expect(chainIdToNetworkId('memo-144')).toBe(toKeccakBytes('memo144'))
  })

  it('honors an explicit type override (smoldapp path)', () => {
    expect(chainIdToNetworkId('eip155-1', 'evm')).toBe(toKeccakBytes('evm1'))
  })
})
