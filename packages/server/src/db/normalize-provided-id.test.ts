import { describe, expect, it } from 'vitest'
import { normalizeProvidedId, canonicalBridgeAddress } from './provided-id'

/**
 * normalizeProvidedId must lowercase EVM addresses (so case variants collapse to one
 * token row) while leaving non-EVM ids untouched — Solana and Tron use case-sensitive
 * base58, where lowercasing destroys the identifier entirely.
 */
describe('normalizeProvidedId', () => {
  it('lowercases checksummed EVM addresses', () => {
    expect(normalizeProvidedId('0xA1077a294dDE1B09bB078844df40758a5D0f9a27')).toBe(
      '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
    )
  })

  it('passes already-lowercase EVM addresses through unchanged', () => {
    expect(normalizeProvidedId('0xa1077a294dde1b09bb078844df40758a5d0f9a27')).toBe(
      '0xa1077a294dde1b09bb078844df40758a5d0f9a27',
    )
  })

  it('preserves case-sensitive Solana base58 ids', () => {
    const usdcOnSolana = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    expect(normalizeProvidedId(usdcOnSolana)).toBe(usdcOnSolana)
  })

  it('preserves case-sensitive Tron base58 ids', () => {
    const usdtOnTron = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    expect(normalizeProvidedId(usdtOnTron)).toBe(usdtOnTron)
  })

  it('passes arbitrary non-address strings through unchanged', () => {
    expect(normalizeProvidedId('Not-An-Address')).toBe('Not-An-Address')
  })
})

/**
 * canonicalBridgeAddress must produce EIP-55 checksummed casing — the bridge_id
 * trigger hashes the stored text case-sensitively and every existing bridge row was
 * inserted checksummed, so any other casing orphans those rows and resets their
 * block-progress checkpoints.
 */
describe('canonicalBridgeAddress', () => {
  it('checksums lowercase EVM addresses', () => {
    expect(canonicalBridgeAddress('0xa1077a294dde1b09bb078844df40758a5d0f9a27')).toBe(
      '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
    )
  })

  it('keeps already-checksummed EVM addresses unchanged', () => {
    expect(canonicalBridgeAddress('0xA1077a294dDE1B09bB078844df40758a5D0f9a27')).toBe(
      '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
    )
  })

  it('passes non-EVM identifiers through unchanged', () => {
    const usdcOnSolana = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    expect(canonicalBridgeAddress(usdcOnSolana)).toBe(usdcOnSolana)
  })
})
