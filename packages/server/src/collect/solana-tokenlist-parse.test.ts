import { describe, it, expect } from 'vitest'
import {
  parseSolanaTokenRecord,
  resolveLogo,
  SOLANA_MAINNET_CLUSTER,
  SOLANA_CHAIN_IDENTIFIER,
} from './solana-tokenlist-parse'

/** A well-formed mainnet Solana token record, cloned and mutated per test. */
const validRecord = () => ({
  chainId: SOLANA_MAINNET_CLUSTER,
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  logoURI: 'https://example.com/usdc.png',
})

describe('parseSolanaTokenRecord', () => {
  it('accepts a well-formed mainnet token', () => {
    expect(parseSolanaTokenRecord(validRecord())).toEqual({
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: 'https://example.com/usdc.png',
    })
  })

  it('keeps the base58 address verbatim (never lowercased)', () => {
    const parsed = parseSolanaTokenRecord(validRecord())
    expect(parsed?.address).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  })

  it('accepts decimals: 0 as a legitimate value', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), decimals: 0 })?.decimals).toBe(0)
  })

  it('yields an empty logo when logoURI is absent', () => {
    const { logoURI: _omit, ...noLogo } = validRecord()
    expect(parseSolanaTokenRecord(noLogo)?.logoURI).toBe('')
  })

  it('skips non-object input', () => {
    expect(parseSolanaTokenRecord(null)).toBeNull()
    expect(parseSolanaTokenRecord('token')).toBeNull()
    expect(parseSolanaTokenRecord(42)).toBeNull()
  })

  it('skips testnet and devnet clusters', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), chainId: 102 })).toBeNull()
    expect(parseSolanaTokenRecord({ ...validRecord(), chainId: 103 })).toBeNull()
  })

  it('skips a record whose chainId is a non-Solana number', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), chainId: 1 })).toBeNull()
  })

  it('skips a missing or empty symbol, name, or address', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), symbol: '' })).toBeNull()
    expect(parseSolanaTokenRecord({ ...validRecord(), name: '   ' })).toBeNull()
    const { address: _drop, ...noAddress } = validRecord()
    expect(parseSolanaTokenRecord(noAddress)).toBeNull()
  })

  it('skips a hex-shaped (non-base58) address', () => {
    expect(
      parseSolanaTokenRecord({ ...validRecord(), address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }),
    ).toBeNull()
  })

  it('skips an address containing base58-excluded characters (0, O, I, l)', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), address: '0OIl' + 'a'.repeat(40) })).toBeNull()
  })

  it('skips a too-short address', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), address: 'abc' })).toBeNull()
  })

  it('skips non-finite or non-number decimals', () => {
    expect(parseSolanaTokenRecord({ ...validRecord(), decimals: '6' })).toBeNull()
    expect(parseSolanaTokenRecord({ ...validRecord(), decimals: Number.NaN })).toBeNull()
    expect(parseSolanaTokenRecord({ ...validRecord(), decimals: Infinity })).toBeNull()
  })
})

describe('resolveLogo', () => {
  it('returns a non-empty string unchanged', () => {
    expect(resolveLogo('https://example.com/x.png')).toBe('https://example.com/x.png')
  })

  it('returns an empty string for blank, missing, or non-string logos', () => {
    expect(resolveLogo('')).toBe('')
    expect(resolveLogo('   ')).toBe('')
    expect(resolveLogo(undefined)).toBe('')
    expect(resolveLogo({ src: 'https://example.com/x.png' })).toBe('')
  })
})

describe('constants', () => {
  it('files Solana tokens under the solana-501 CAIP-2 identifier', () => {
    expect(SOLANA_CHAIN_IDENTIFIER).toBe('solana-501')
  })
})
