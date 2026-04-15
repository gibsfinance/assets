import { describe, it, expect } from 'vitest'
import { getNetworkName } from './network-name'

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

    it('returns Sonic for chain 900', () => {
      expect(getNetworkName(900)).toBe('Sonic')
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
      // Chain 25 = Cronos Mainnet Beta in networks.json
      expect(getNetworkName('25')).toBe('Cronos Mainnet Beta')
    })
  })

  describe('fallback to networks.json', () => {
    it('returns name from networks.json for non-priority chain', () => {
      // Chain 5 = Gorli in networks.json
      expect(getNetworkName(5)).toBe('Görli')
    })

    it('returns name from networks.json for another non-priority chain', () => {
      // Chain 8 = Ubiq in networks.json
      expect(getNetworkName(8)).toBe('Ubiq')
    })

    it('returns name from networks.json for chain 14', () => {
      expect(getNetworkName(14)).toBe('Flare Mainnet')
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
    it('prefers priority name when both exist', () => {
      // Chain 1 is in both priorityNames and networks.json
      // Both say "Ethereum" but the priority lookup runs first
      expect(getNetworkName(1)).toBe('Ethereum')
    })

    it('prefers priority name for Optimism (chain 10)', () => {
      // Chain 10 is in both — networks.json also has "Optimism"
      expect(getNetworkName(10)).toBe('Optimism')
    })
  })
})
