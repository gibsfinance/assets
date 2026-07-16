import { describe, it, expect } from 'vitest'
import { isTestnet } from './is-testnet'

const named = (name: string, title?: string | null) => isTestnet({ name, title })

describe('isTestnet', () => {
  it('matches names that say testnet or devnet', () => {
    expect(named('PulseChain Testnet v4')).toBe(true)
    expect(named('Base Sepolia Testnet')).toBe(true)
    expect(named('Neura Devnet')).toBe(true)
    expect(named('Nibiru devnet-3')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(named('SOME TESTNET CHAIN')).toBe(true)
    expect(named('Ruby Smart Chain MAINNET')).toBe(false)
  })

  // The registry really ships this name. A trailing \b would not match it, because
  // there is no word boundary between "Testnet" and "2".
  it('matches a testnet name that runs into a digit', () => {
    expect(named('Core Blockchain Testnet2')).toBe(true)
  })

  // 'test' is matched as a whole word, not only as part of "testnet" — the registry
  // ships plenty of "... Test Network" chains that never say testnet.
  it('matches a bare "Test" in the name', () => {
    expect(named('Columbus Test Network')).toBe(true)
    expect(named('DFK Chain Test')).toBe(true)
    expect(named('ONIGIRI Test Subnet')).toBe(true)
  })

  // The front anchor earns its keep here: without \b, "test" fires inside ordinary words.
  it('does not fire on test as a substring of an unrelated word', () => {
    expect(named('Latest Chain')).toBe(false)
    expect(named('Greatest Network')).toBe(false)
    expect(named('Attestation Chain')).toBe(false)
    expect(named('Protest Chain')).toBe(false)
  })

  /**
   * The reason this function takes a title at all. These chains are named after a
   * codename and state the fact only in the registry's title, so a name-only rule
   * counted every one of them as a mainnet.
   */
  describe('title', () => {
    it('matches a codename whose title says testnet', () => {
      expect(named('Adiri', 'Telcoin Network Testnet')).toBe(true)
      expect(named('Tucana', 'Tucana Testnet')).toBe(true)
      expect(named('Rinia', 'Firechain Testnet Rinia')).toBe(true)
      expect(named('MetaChain Istanbul', 'MetaChain Testnet Istanbul')).toBe(true)
      expect(named('Kerleano', 'Proof of Climate awaReness testnet')).toBe(true)
    })

    it('still classifies without a title, since most chains ship none', () => {
      expect(named('Ethereum Sepolia', null)).toBe(true)
      expect(named('Ethereum', null)).toBe(false)
      expect(named('Ethereum', undefined)).toBe(false)
    })

    // No chain in the registry titles itself a testnet while being a mainnet, so a
    // title can add a match but must never be the reason a real chain disappears.
    it('does not flag a mainnet whose title is ordinary prose', () => {
      expect(named('Ethereum', 'Ethereum Mainnet')).toBe(false)
      expect(named('World Chain', 'World Chain L2')).toBe(false)
    })
  })

  it('matches testnet families whose names say it nowhere', () => {
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
      'Status Network Hoodi',
    ]) {
      expect(named(name), name).toBe(true)
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
      expect(named(name), name).toBe(false)
    }
  })

  /**
   * Chains that state it in neither name nor title. Documented rather than asserted as
   * correct: erring this way shows a few extra chains instead of hiding a real one.
   * Delete this if a structured signal ever becomes trustworthy.
   */
  it('misses testnet codenames that say it nowhere — the known limitation', () => {
    for (const name of ['Puppynet', 'Curtis', 'Berachain Bepolia', 'Taiko Jolnir L2', 'Zhejiang', 'Tron Shasta']) {
      expect(named(name), name).toBe(false)
    }
  })
})
