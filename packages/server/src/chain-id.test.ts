import { describe, it, expect } from 'vitest'
import {
  toCAIP2,
  fromCAIP2,
  namespaceOf,
  isBareNumeric,
  isValidChainId,
  namespaceToNetworkType,
  expectedNetworkType,
  isFakedEvmReference,
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
  it('lists the registered non-Ethereum-Virtual-Machine namespaces', () => {
    expect([...NON_EVM_NAMESPACES].sort()).toEqual([
      'algorand',
      'aptos',
      'bip122',
      'cardano',
      'cosmos',
      'fil',
      'memo',
      'monero',
      'near',
      'polkadot',
      'solana',
      'sui',
      'ton',
      'tvm',
    ])
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

  it('serves the newly added chains under their own type', () => {
    // Each added namespace must both validate and hash to its own type, or the
    // network_id computed at lookup would not reproduce the trigger-written one.
    expect(namespaceToNetworkType('sui')).toBe('sui')
    expect(namespaceToNetworkType('aptos')).toBe('aptos')
    expect(namespaceToNetworkType('cosmos')).toBe('cosmos')
    expect(namespaceToNetworkType('near')).toBe('near')
    expect(namespaceToNetworkType('polkadot')).toBe('polkadot')
    expect(namespaceToNetworkType('algorand')).toBe('algorand')
    expect(namespaceToNetworkType('fil')).toBe('fil')
    expect(isValidChainId('sui-784')).toBe(true)
    expect(isValidChainId('aptos-637')).toBe(true)
    expect(isValidChainId('cosmos-118')).toBe(true)
    expect(isValidChainId('near-397')).toBe(true)
    expect(isValidChainId('polkadot-354')).toBe(true)
    expect(isValidChainId('algorand-283')).toBe(true)
    expect(isValidChainId('fil-461')).toBe(true)
  })

  it('still accepts legacy identifiers and rejects unknown namespaces', () => {
    expect(isValidChainId('369')).toBe(true)
    expect(isValidChainId('eip155-1')).toBe(true)
    expect(isValidChainId('asset-0')).toBe(true)
    // tezos is a real chain but not yet a registered gib.show namespace.
    expect(isValidChainId('tezos-1')).toBe(false)
    expect(isValidChainId('bip122-notanumber')).toBe(false)
  })
})

describe('expectedNetworkType', () => {
  it('derives evm for bare numeric, eip155, and asset identifiers', () => {
    expect(expectedNetworkType('1')).toBe('evm')
    expect(expectedNetworkType('369')).toBe('evm')
    expect(expectedNetworkType('eip155-1')).toBe('evm')
    expect(expectedNetworkType('asset-0')).toBe('evm')
  })

  it('derives each non-Ethereum-Virtual-Machine namespace to its own type', () => {
    expect(expectedNetworkType('tvm-195')).toBe('tvm')
    expect(expectedNetworkType('bip122-0')).toBe('bip122')
    expect(expectedNetworkType('solana-501')).toBe('solana')
    expect(expectedNetworkType('ton-607')).toBe('ton')
  })

  it('flags the corruption class: a bare-numeric id never expects a non-evm type', () => {
    // insertNetworkFromChainId hashed the smoldapp "btcm" folder to 1651794797
    // and typed it 'btc'; the identifier normalizes to eip155-1651794797, whose
    // expected type is 'evm'. The mismatch is exactly what the boundary guard now
    // rejects so a "btc"-typed eip155 network can never be written again.
    expect(expectedNetworkType('1651794797')).toBe('evm')
    expect(expectedNetworkType('1651794797')).not.toBe('btc')
    // A bare '1' with an intended 'tvm' is likewise a mismatch (eip155-1 is Ethereum).
    expect(expectedNetworkType('1')).not.toBe('tvm')
  })
})

describe('isFakedEvmReference', () => {
  it('flags the non-EVM chains upstream lists mis-number as eip155', () => {
    // Bare and prefixed forms both resolve to the same faked reference.
    expect(isFakedEvmReference('501000101')).toBe(true) // Solana (bridged list)
    expect(isFakedEvmReference('728126428')).toBe(true) // Tron (native eip155 id)
    expect(isFakedEvmReference('eip155-728126428')).toBe(true)
  })

  // Regression: 900/1000 are DexScreener/TrustWallet internal handles for Solana and
  // Tron, and both collectors resolve them to solana-501/tvm-195 before insert — the
  // bare numbers never reach the funnel. Banning them here rejected the real EVM
  // chains that hold those ids in the ethereum-lists registry, so the icon-bearing
  // Garizon Testnet Stage0 (900) silently vanished from /networks.
  it('does not flag the real EVM chains that own the provider-handle numbers', () => {
    expect(isFakedEvmReference('900')).toBe(false) // Garizon Testnet Stage0
    expect(isFakedEvmReference('1000')).toBe(false) // GTON Mainnet
    expect(isFakedEvmReference('eip155-900')).toBe(false)
  })

  it('never flags a real EVM chain or a correctly namespaced non-EVM id', () => {
    expect(isFakedEvmReference('1')).toBe(false) // Ethereum
    expect(isFakedEvmReference('369')).toBe(false) // PulseChain
    expect(isFakedEvmReference('728126428000')).toBe(false) // not the Tron reference
    expect(isFakedEvmReference('solana-501')).toBe(false) // already correct
    expect(isFakedEvmReference('tvm-195')).toBe(false) // already correct
    expect(isFakedEvmReference('asset-0')).toBe(false)
  })
})
