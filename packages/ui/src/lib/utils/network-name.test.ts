import { describe, it, expect } from 'vitest'
import { getNetworkName } from './network-name'
import networksJson from '../networks.json'

/**
 * networks.json is generated from the ethereum-lists registry (yarn gen:networks),
 * which renames chains on its own schedule. Tests that cover the generated map assert
 * the lookup against this import rather than a copied string — pinning the literal
 * name only records what the registry happened to say on the day it was vendored.
 * The curated maps this repo owns (priorityNames, NON_EVM_NAMES) stay pinned.
 */
const generated = networksJson as Record<string, string>

describe('getNetworkName', () => {
  describe('priority names', () => {
    it('returns Ethereum for chain 1', () => {
      expect(getNetworkName(1)).toBe('Ethereum')
    })

    it('returns PulseChain for chain 369', () => {
      expect(getNetworkName(369)).toBe('PulseChain')
    })

    it('returns BNB Smart Chain for chain 56', () => {
      expect(getNetworkName(56)).toBe('BNB Smart Chain')
    })

    it('returns Polygon for chain 137', () => {
      expect(getNetworkName(137)).toBe('Polygon')
    })

    it('returns Arbitrum One for chain 42161', () => {
      expect(getNetworkName(42161)).toBe('Arbitrum One')
    })

    it('returns Optimism for chain 10', () => {
      expect(getNetworkName(10)).toBe('Optimism')
    })

    it('returns Base for chain 8453', () => {
      expect(getNetworkName(8453)).toBe('Base')
    })

    it('returns Avalanche C-Chain for chain 43114', () => {
      expect(getNetworkName(43114)).toBe('Avalanche C-Chain')
    })

    it('returns Zora for chain 7777777', () => {
      expect(getNetworkName(7777777)).toBe('Zora')
    })

    it('returns Sonic for chain 146', () => {
      expect(getNetworkName(146)).toBe('Sonic')
    })

    it('returns Tron Mainnet for chain 728126428', () => {
      expect(getNetworkName(728126428)).toBe('Tron Mainnet')
    })
  })

  describe('string input', () => {
    it('accepts chainId as string and returns priority name', () => {
      expect(getNetworkName('1')).toBe('Ethereum')
    })

    it('accepts string chainId for non-priority networks', () => {
      expect(getNetworkName('25')).toBe(generated['25'])
    })
  })

  describe('fallback to networks.json', () => {
    it('returns the generated name for a non-priority chain', () => {
      expect(generated['5']).toBeTruthy()
      expect(getNetworkName(5)).toBe(generated['5'])
    })

    it('returns the generated name for another non-priority chain', () => {
      expect(generated['8']).toBeTruthy()
      expect(getNetworkName(8)).toBe(generated['8'])
    })

    it('strips the eip155 prefix before the generated-map lookup', () => {
      expect(generated['14']).toBeTruthy()
      expect(getNetworkName('eip155-14')).toBe(generated['14'])
      expect(getNetworkName(14)).toBe(generated['14'])
    })

    // The registry lists Garizon Testnet Stage0 at chain 900, which the server briefly
    // refused to collect because DexScreener uses 900 as its internal Solana handle.
    // Naming it here keeps the drawer honest once the network is served again.
    it('names the real chains that sit behind provider handle numbers', () => {
      expect(generated['900']).toBe('Garizon Testnet Stage0')
      expect(getNetworkName(900)).toBe('Garizon Testnet Stage0')
    })
  })

  describe('unknown chains', () => {
    it('returns "Chain <id>" for completely unknown chain IDs', () => {
      expect(getNetworkName(9999999999)).toBe('Chain 9999999999')
    })

    it('formats fallback with the numeric chain ID', () => {
      expect(getNetworkName(8888888888)).toBe('Chain 8888888888')
    })

    it('handles string input for unknown chains', () => {
      expect(getNetworkName('9999999999')).toBe('Chain 9999999999')
    })
  })

  describe('priority over networks.json', () => {
    // The registry's formal names ("Ethereum Mainnet", "OP Mainnet") are not what the
    // drawer should read, so priorityNames overrides them. Asserting the generated map
    // disagrees proves the override is load-bearing: if a regen ever aligned the two,
    // these would pass while testing nothing.
    it('prefers the curated name over the generated one for Ethereum', () => {
      expect(generated['1']).not.toBe('Ethereum')
      expect(getNetworkName(1)).toBe('Ethereum')
    })

    it('prefers the curated name over the generated one for Optimism', () => {
      expect(generated['10']).not.toBe('Optimism')
      expect(getNetworkName(10)).toBe('Optimism')
    })
  })

  it('names the curated non-Ethereum-Virtual-Machine chains by identifier', () => {
    expect(getNetworkName('bip122-0')).toBe('Bitcoin')
    expect(getNetworkName('cardano-1815')).toBe('Cardano')
    expect(getNetworkName('tvm-195')).toBe('Tron')
    expect(getNetworkName('sui-784')).toBe('Sui')
    expect(getNetworkName('aptos-637')).toBe('Aptos')
    expect(getNetworkName('ton-607')).toBe('TON')
    expect(getNetworkName('cosmos-118')).toBe('Cosmos')
    expect(getNetworkName('near-397')).toBe('NEAR')
    expect(getNetworkName('polkadot-354')).toBe('Polkadot')
    expect(getNetworkName('algorand-283')).toBe('Algorand')
    expect(getNetworkName('fil-461')).toBe('Filecoin')
  })

  it('still names Ethereum-Virtual-Machine chains from bare and prefixed ids', () => {
    expect(getNetworkName(1)).toBe('Ethereum')
    expect(getNetworkName('eip155-369')).toBe('PulseChain')
    expect(getNetworkName('369')).toBe('PulseChain')
  })
})
