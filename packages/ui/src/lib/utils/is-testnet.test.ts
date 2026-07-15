import { describe, it, expect } from 'vitest'
import { isTestnetName } from './is-testnet'

describe('isTestnetName', () => {
  it('matches names that say testnet or devnet', () => {
    expect(isTestnetName('PulseChain Testnet v4')).toBe(true)
    expect(isTestnetName('Base Sepolia Testnet')).toBe(true)
    expect(isTestnetName('Neura Devnet')).toBe(true)
    expect(isTestnetName('Nibiru devnet-3')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isTestnetName('SOME TESTNET CHAIN')).toBe(true)
    expect(isTestnetName('Ruby Smart Chain MAINNET')).toBe(false)
  })

  // The registry really ships this name. A trailing \b would not match it, because
  // there is no word boundary between "Testnet" and "2".
  it('matches a testnet name that runs into a digit', () => {
    expect(isTestnetName('Core Blockchain Testnet2')).toBe(true)
  })

  /**
   * The whole reason this exists. A plain "testnet" substring counted every one of
   * these as a mainnet, inflating the supported-chain count and leaking test chains
   * into the drawer with the testnet toggle off.
   */
  it('matches testnet families whose names never say testnet', () => {
    for (const name of [
      'Goerli',
      'Ethereum Sepolia',
      'Amoy',
      'Holesky',
      'Arbitrum Sepolia',
      'Optimism Kovan',
      'Rinkeby',
      'Ropsten',
      'Mumbai',
      'Avalanche Fuji',
      'Gnosis Chiado',
      'Celo Alfajores',
      'Hedera Previewnet',
      'Moonbase Alpha',
    ]) {
      expect(isTestnetName(name), name).toBe(true)
    }
  })

  it('does not flag production chains', () => {
    for (const name of [
      'Ethereum',
      'PulseChain',
      'Base',
      'Optimism',
      'Arbitrum One',
      'Gnosis Chain',
      'Avalanche C-Chain',
      'BNB Smart Chain',
      'Bitcoin',
      'Solana',
      'Tron',
      'Zora',
      'World Chain',
      'Injective',
      'Immutable zkEVM',
      'Treasure',
      'CrossFi Mainnet',
    ]) {
      expect(isTestnetName(name), name).toBe(false)
    }
  })

  /**
   * Codenames carry no signal in the string, so they read as mainnets. Documented
   * rather than asserted as correct: erring this way shows a few extra chains instead
   * of hiding a real one. Delete this if a structured signal ever replaces the match.
   */
  it('misses testnet codenames — the known limitation', () => {
    for (const name of ['Puppynet', 'Curtis', 'Berachain Bepolia', 'Taiko Jolnir L2', 'Zhejiang', 'Tron Shasta']) {
      expect(isTestnetName(name), name).toBe(false)
    }
  })
})
