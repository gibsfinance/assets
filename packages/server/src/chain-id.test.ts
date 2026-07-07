import { describe, it, expect } from 'vitest'
import {
  toCAIP2,
  fromCAIP2,
  namespaceOf,
  isBareNumeric,
  isValidChainId,
  namespaceToNetworkType,
  NON_EVM_NAMESPACES,
} from './chain-id'

describe('toCAIP2', () => {
  it('prefixes EVM chain IDs with eip155', () => {
    expect(toCAIP2('1')).toBe('eip155-1')
    expect(toCAIP2('369')).toBe('eip155-369')
    expect(toCAIP2('56')).toBe('eip155-56')
    expect(toCAIP2('8453')).toBe('eip155-8453')
  })

  it('maps chain 0 to asset-0', () => {
    expect(toCAIP2('0')).toBe('asset-0')
  })

  it('passes through values that already have a dash (CAIP-2 format)', () => {
    expect(toCAIP2('eip155-369')).toBe('eip155-369')
    expect(toCAIP2('asset-0')).toBe('asset-0')
    expect(toCAIP2('solana-mainnet')).toBe('solana-mainnet')
  })
})

describe('fromCAIP2', () => {
  it('extracts the reference from EVM CAIP-2 strings', () => {
    expect(fromCAIP2('eip155-369')).toBe('369')
    expect(fromCAIP2('eip155-1')).toBe('1')
    expect(fromCAIP2('eip155-56')).toBe('56')
  })

  it('extracts the reference from asset namespace', () => {
    expect(fromCAIP2('asset-0')).toBe('0')
  })

  it('passes through bare numbers', () => {
    expect(fromCAIP2('369')).toBe('369')
    expect(fromCAIP2('0')).toBe('0')
  })
})

describe('namespaceOf', () => {
  it('extracts namespace from CAIP-2 strings', () => {
    expect(namespaceOf('eip155-369')).toBe('eip155')
    expect(namespaceOf('asset-0')).toBe('asset')
    expect(namespaceOf('solana-mainnet')).toBe('solana')
  })

  it('defaults to eip155 for bare numbers', () => {
    expect(namespaceOf('369')).toBe('eip155')
    expect(namespaceOf('1')).toBe('eip155')
  })
})

describe('isBareNumeric', () => {
  it('returns true for numeric strings', () => {
    expect(isBareNumeric('369')).toBe(true)
    expect(isBareNumeric('0')).toBe(true)
  })

  it('returns false for CAIP-2 strings', () => {
    expect(isBareNumeric('eip155-369')).toBe(false)
    expect(isBareNumeric('asset-0')).toBe(false)
  })

  it('returns false for empty or non-numeric', () => {
    expect(isBareNumeric('')).toBe(false)
    expect(isBareNumeric('abc')).toBe(false)
  })
})

describe('isValidChainId', () => {
  it('accepts bare numeric and prefixed eip155 ids', () => {
    expect(isValidChainId('369')).toBe(true)
    expect(isValidChainId('1')).toBe(true)
    expect(isValidChainId('eip155-369')).toBe(true)
  })

  it('accepts chain 0 in both forms (asset namespace)', () => {
    expect(isValidChainId('0')).toBe(true)
    expect(isValidChainId('asset-0')).toBe(true)
  })

  it('rejects ids that can never match a stored network', () => {
    // Stored networks only carry eip155-<number> or asset-0 (see
    // insertNetworkFromChainId) — handlers use this to 400 early instead of
    // answering 200 with zero tokens.
    expect(isValidChainId('banana')).toBe(false)
    expect(isValidChainId('eip155-banana')).toBe(false)
    expect(isValidChainId('eip155-')).toBe(false)
    expect(isValidChainId('solana-mainnet')).toBe(false)
  })
})

describe('namespace registry', () => {
  it('lists the seven non-Ethereum-Virtual-Machine namespaces', () => {
    expect([...NON_EVM_NAMESPACES].sort()).toEqual(['bip122', 'cardano', 'memo', 'monero', 'solana', 'ton', 'tvm'])
  })

  it('maps the ton namespace to its own type (not evm) so ton-607 serves', () => {
    // Trust the DexScreener collector writes ton-607 as type 'ton'; the serving
    // path must resolve the same type or the network_id hash would not match.
    expect(namespaceToNetworkType('ton')).toBe('ton')
    expect(isValidChainId('ton-607')).toBe(true)
  })

  it('maps non-Ethereum-Virtual-Machine namespaces to their own type, others to evm', () => {
    expect(namespaceToNetworkType('bip122')).toBe('bip122')
    expect(namespaceToNetworkType('memo')).toBe('memo')
    expect(namespaceToNetworkType('eip155')).toBe('evm')
    expect(namespaceToNetworkType('asset')).toBe('evm')
  })

  it('accepts non-Ethereum-Virtual-Machine identifiers with a numeric reference', () => {
    expect(isValidChainId('bip122-0')).toBe(true)
    expect(isValidChainId('solana-501')).toBe(true)
    expect(isValidChainId('memo-144')).toBe(true)
  })

  it('still accepts legacy identifiers and rejects unknown namespaces', () => {
    expect(isValidChainId('369')).toBe(true)
    expect(isValidChainId('eip155-1')).toBe(true)
    expect(isValidChainId('asset-0')).toBe(true)
    expect(isValidChainId('cosmos-1')).toBe(false)
    expect(isValidChainId('bip122-notanumber')).toBe(false)
  })
})
