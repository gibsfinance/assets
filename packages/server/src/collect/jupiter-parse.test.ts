import { describe, it, expect } from 'vitest'
import { parseJupiterToken, MEANINGFUL_TAGS, SOLANA_CHAIN_IDENTIFIER } from './jupiter-parse'

/** A well-formed Jupiter token object, cloned and mutated per test. */
const validToken = () => ({
  id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  name: 'USD Coin',
  symbol: 'USDC',
  icon: 'https://example.com/usdc.png',
  decimals: 6,
  tags: ['verified', 'stable'],
})

describe('parseJupiterToken', () => {
  it('maps id -> address and icon -> logoURI', () => {
    expect(parseJupiterToken(validToken())).toEqual({
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      logoURI: 'https://example.com/usdc.png',
      tags: ['verified', 'stable'],
    })
  })

  it('keeps the base58 address verbatim (never lowercased)', () => {
    expect(parseJupiterToken(validToken())?.address).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  })

  it('accepts decimals: 0', () => {
    expect(parseJupiterToken({ ...validToken(), decimals: 0 })?.decimals).toBe(0)
  })

  it('defaults a missing icon to an empty logo', () => {
    const { icon: _drop, ...noIcon } = validToken()
    expect(parseJupiterToken(noIcon)?.logoURI).toBe('')
  })

  it('defaults a missing or non-array tags field to an empty array', () => {
    const { tags: _drop, ...noTags } = validToken()
    expect(parseJupiterToken(noTags)?.tags).toEqual([])
    expect(parseJupiterToken({ ...validToken(), tags: 'verified' })?.tags).toEqual([])
  })

  it('drops non-string tags', () => {
    expect(parseJupiterToken({ ...validToken(), tags: ['verified', 42, null, 'lst'] })?.tags).toEqual([
      'verified',
      'lst',
    ])
  })

  it('skips non-object input', () => {
    expect(parseJupiterToken(null)).toBeNull()
    expect(parseJupiterToken('token')).toBeNull()
  })

  it('skips a missing id', () => {
    const { id: _drop, ...noId } = validToken()
    expect(parseJupiterToken(noId)).toBeNull()
  })

  it('skips a hex-shaped (non-base58) id', () => {
    expect(parseJupiterToken({ ...validToken(), id: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' })).toBeNull()
  })

  it('skips an id with base58-excluded characters (0, O, I, l)', () => {
    expect(parseJupiterToken({ ...validToken(), id: '0OIl' + 'a'.repeat(40) })).toBeNull()
  })

  it('skips a missing or empty symbol or name', () => {
    expect(parseJupiterToken({ ...validToken(), symbol: '' })).toBeNull()
    expect(parseJupiterToken({ ...validToken(), name: '  ' })).toBeNull()
  })

  it('skips non-finite or non-number decimals', () => {
    expect(parseJupiterToken({ ...validToken(), decimals: '6' })).toBeNull()
    expect(parseJupiterToken({ ...validToken(), decimals: Number.NaN })).toBeNull()
  })
})

describe('metadata', () => {
  it('files Jupiter tokens under the solana-501 CAIP-2 identifier', () => {
    expect(SOLANA_CHAIN_IDENTIFIER).toBe('solana-501')
  })

  it('leads the tag split with the verified universe', () => {
    expect(MEANINGFUL_TAGS[0]).toBe('verified')
    expect(MEANINGFUL_TAGS).toContain('lst')
    expect(MEANINGFUL_TAGS).toContain('meme')
  })
})
