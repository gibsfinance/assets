import { describe, it, expect, vi } from 'vitest'
// ../utils instantiates the Ink terminal renderer at module load, which cannot
// run under vitest. An endlessly-chainable no-op stands in.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import {
  COINGECKO_NON_EVM_PLATFORMS,
  isValidPlatformAddress,
  normalizePlatformAddress,
  resolvePlatform,
} from './coingecko-platforms'
import { isValidChainId } from '../chain-id'
import { chainIdToNetworkId, toKeccakBytes } from '../utils'

// A real USDC mint (Solana) and a real Tron address — case-significant base58.
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TRON_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const EVM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

describe('resolvePlatform', () => {
  it('resolves Ethereum-Virtual-Machine platforms from their numeric chain_identifier', () => {
    expect(resolvePlatform('binance-smart-chain', 56)).toEqual({
      chainIdentifier: 'eip155-56',
      type: 'evm',
      listKey: '56', // bare-numeric, unchanged from the EVM-only era
      evm: true,
    })
  })

  it('redirects supported non-EVM platforms to their coin-type identifier', () => {
    expect(resolvePlatform('solana', null)).toEqual({
      chainIdentifier: 'solana-501',
      type: 'solana',
      listKey: 'solana-501',
      evm: false,
    })
    expect(resolvePlatform('tron', null)).toEqual({
      chainIdentifier: 'tvm-195',
      type: 'tvm',
      listKey: 'tvm-195',
      evm: false,
    })
  })

  it('skips null-identifier platforms that are not yet supported (e.g. sui)', () => {
    expect(resolvePlatform('sui', null)).toBeNull()
    expect(resolvePlatform('some-cosmos-chain', null)).toBeNull()
  })

  it('every resolved identifier is servable and hashes consistently', () => {
    for (const platform of [resolvePlatform('binance-smart-chain', 56)!, resolvePlatform('solana', null)!]) {
      expect(isValidChainId(platform.chainIdentifier)).toBe(true)
      const reference = platform.chainIdentifier.split('-')[1]
      expect(chainIdToNetworkId(platform.chainIdentifier, platform.type)).toBe(
        toKeccakBytes(`${platform.type}${reference}`),
      )
    }
  })
})

describe('isValidPlatformAddress', () => {
  const solana = resolvePlatform('solana', null)!
  const tron = resolvePlatform('tron', null)!
  const evm = resolvePlatform('ethereum', 1)!

  it('accepts real base58 ids on non-EVM platforms', () => {
    expect(isValidPlatformAddress(solana, SOLANA_USDC)).toBe(true)
    expect(isValidPlatformAddress(tron, TRON_USDT)).toBe(true)
  })

  it('rejects a hex address on a non-EVM platform (0x is not base58)', () => {
    // Base58 excludes 0 and x, so a leaked EVM address is dropped, not stored.
    expect(isValidPlatformAddress(solana, EVM_USDC)).toBe(false)
  })

  it('accepts a hex address on an EVM platform and rejects base58 there', () => {
    expect(isValidPlatformAddress(evm, EVM_USDC)).toBe(true)
    expect(isValidPlatformAddress(evm, SOLANA_USDC)).toBe(false)
  })
})

describe('normalizePlatformAddress', () => {
  const solana = resolvePlatform('solana', null)!
  const evm = resolvePlatform('ethereum', 1)!

  it('preserves case for non-EVM base58 ids', () => {
    expect(normalizePlatformAddress(solana, SOLANA_USDC)).toBe(SOLANA_USDC)
  })

  it('lowercases EVM addresses', () => {
    expect(normalizePlatformAddress(evm, EVM_USDC)).toBe(EVM_USDC.toLowerCase())
  })
})

describe('COINGECKO_NON_EVM_PLATFORMS', () => {
  it('only lists namespaces present in the closed non-EVM set', () => {
    for (const { chainIdentifier } of Object.values(COINGECKO_NON_EVM_PLATFORMS)) {
      expect(isValidChainId(chainIdentifier), `${chainIdentifier} must be servable`).toBe(true)
    }
  })
})
