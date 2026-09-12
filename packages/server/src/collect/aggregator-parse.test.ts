/**
 * Reading rules for a bridge aggregator's token catalogue.
 *
 * An aggregator publishes every token it will route, not a curated list, so
 * these functions are the only check standing between an unverified feed and
 * the artwork this service serves. Each test below pins one claim from the
 * module comment in aggregator-parse.ts so a later change cannot loosen a
 * rule without a test noticing.
 */
import { describe, it, expect } from 'vitest'
import {
  readToken,
  countRejection,
  groupByChain,
  dedupeByAddress,
  asRecord,
  presentText,
  wholeNumber,
  isWholeAtLeastZero,
  MAX_DECIMALS,
  type AggregatorToken,
  type RejectionCounts,
} from './aggregator-parse'

/** A complete, valid set of fields, so each test only overrides what it checks. */
const validFields = () => ({
  chainId: 1,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  logoURI: 'https://example.com/usdc.png',
})

/** Build one finished token for the grouping and deduplication tests. */
const buildToken = (overrides: Partial<AggregatorToken>): AggregatorToken => ({
  chainId: 1,
  address: '0xAAAA',
  name: 'Token',
  symbol: 'TOK',
  decimals: 18,
  logoURI: null,
  ...overrides,
})

describe('readToken', () => {
  it('carries every field through unchanged for a complete token', () => {
    const result = readToken(validFields())
    expect(result).toEqual({
      chainId: 1,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      logoURI: 'https://example.com/usdc.png',
    })
  })

  it('accepts a token with zero decimals instead of treating zero as missing', () => {
    // A silent rewrite from zero to eighteen decimals moves every amount for
    // this token by a factor of ten to the eighteenth power. Nine verified
    // tokens on Ethereum in LiFi's own catalogue declare zero decimals today,
    // so this is not a hypothetical input.
    const result = readToken({ ...validFields(), decimals: 0 })
    expect('reason' in result).toBe(false)
    expect((result as AggregatorToken).decimals).toBe(0)
  })

  it('accepts the largest legal decimals value and rejects one step past it', () => {
    // The token standard stores decimals in an unsigned eight-bit field, so
    // this boundary is a real limit, not a display choice.
    const atLimit = readToken({ ...validFields(), decimals: MAX_DECIMALS })
    expect('reason' in atLimit).toBe(false)
    expect((atLimit as AggregatorToken).decimals).toBe(255)

    const overLimit = readToken({ ...validFields(), decimals: MAX_DECIMALS + 1 })
    expect(overLimit).toEqual({ reason: 'decimals outside 0 to 255' })
  })

  it('rejects a missing decimals value instead of defaulting it to eighteen', () => {
    const result = readToken({ ...validFields(), decimals: undefined })
    expect(result).toEqual({ reason: 'decimals outside 0 to 255' })
  })

  it('rejects a negative decimals value', () => {
    const result = readToken({ ...validFields(), decimals: -1 })
    expect(result).toEqual({ reason: 'decimals outside 0 to 255' })
  })

  it('rejects a fractional decimals value', () => {
    const result = readToken({ ...validFields(), decimals: 6.5 })
    expect(result).toEqual({ reason: 'decimals outside 0 to 255' })
  })

  it('rejects a decimals value that cannot be read as a number at all', () => {
    const result = readToken({ ...validFields(), decimals: 'a lot' })
    expect(result).toEqual({ reason: 'decimals outside 0 to 255' })
  })

  it('reads a decimals value supplied as digits in a string, because real feeds send it that way', () => {
    const result = readToken({ ...validFields(), decimals: '6' })
    expect('reason' in result).toBe(false)
    const token = result as AggregatorToken
    expect(token.decimals).toBe(6)
    expect(typeof token.decimals).toBe('number')
  })

  it('rejects a missing address rather than storing the word "undefined"', () => {
    const result = readToken({ ...validFields(), address: undefined })
    expect(result).toEqual({ reason: 'no address' })
  })

  it('rejects a blank address instead of treating whitespace as present', () => {
    const result = readToken({ ...validFields(), address: '   ' })
    expect(result).toEqual({ reason: 'no address' })
  })

  it('rejects a missing symbol', () => {
    const result = readToken({ ...validFields(), symbol: undefined })
    expect(result).toEqual({ reason: 'no symbol' })
  })

  it('falls back the name to the symbol when the source sends no name, on purpose', () => {
    // The fallback is a deliberate choice stated in the source comment, not an
    // accident of a blank column reaching the database.
    const result = readToken({ ...validFields(), name: undefined })
    expect('reason' in result).toBe(false)
    expect((result as AggregatorToken).name).toBe('USDC')
  })

  it('rejects a chain id of zero, because chain zero is not a chain', () => {
    const result = readToken({ ...validFields(), chainId: 0 })
    expect(result).toEqual({ reason: 'unreadable chain id' })
  })

  it('rejects a negative chain id', () => {
    const result = readToken({ ...validFields(), chainId: -1 })
    expect(result).toEqual({ reason: 'unreadable chain id' })
  })

  it('rejects a fractional chain id', () => {
    const result = readToken({ ...validFields(), chainId: 1.5 })
    expect(result).toEqual({ reason: 'unreadable chain id' })
  })

  it('rejects a chain id that cannot be read as a number at all', () => {
    const result = readToken({ ...validFields(), chainId: 'mainnet' })
    expect(result).toEqual({ reason: 'unreadable chain id' })
  })

  it('trims padding from text fields instead of storing it', () => {
    const result = readToken({ ...validFields(), address: '  0xPADDED  ', name: '  Padded Coin  ' })
    expect('reason' in result).toBe(false)
    const token = result as AggregatorToken
    expect(token.address).toBe('0xPADDED')
    expect(token.name).toBe('Padded Coin')
  })

  it('treats a logo field that is missing as no logo, not as a blank string', () => {
    const result = readToken({ ...validFields(), logoURI: undefined })
    expect('reason' in result).toBe(false)
    expect((result as AggregatorToken).logoURI).toBeNull()
  })
})

describe('countRejection', () => {
  it('tallies rejections by reason and keeps a running total across calls', () => {
    const rejected: RejectionCounts = {}
    countRejection(rejected, 'no address')
    countRejection(rejected, 'no address')
    countRejection(rejected, 'no symbol')
    expect(rejected).toEqual({ 'no address': 2, 'no symbol': 1 })
  })
})

describe('groupByChain', () => {
  it('keeps each chain in its original order and files each token under its own chain', () => {
    const first = buildToken({ chainId: 1, address: '0xFIRST' })
    const second = buildToken({ chainId: 137, address: '0xSECOND' })
    const third = buildToken({ chainId: 1, address: '0xTHIRD' })

    const byChain = groupByChain([first, second, third])

    expect(byChain.get(1)).toEqual([first, third])
    expect(byChain.get(137)).toEqual([second])
  })
})

describe('dedupeByAddress', () => {
  it('keeps the first occurrence, compares addresses without regard to letter case', () => {
    const first = buildToken({ chainId: 1, address: '0xAAAA' })
    const repeat = buildToken({ chainId: 1, address: '0xaaaa', name: 'Repeat' })

    const kept = dedupeByAddress([first, repeat])

    expect(kept).toEqual([first])
  })

  it('keeps the same address on two different chains as two different tokens', () => {
    // This is the claim most likely to be got wrong: identity here is the pair
    // of chain and address, not the address alone.
    const onMainnet = buildToken({ chainId: 1, address: '0xAAAA' })
    const onPolygon = buildToken({ chainId: 137, address: '0xAAAA' })

    const kept = dedupeByAddress([onMainnet, onPolygon])

    expect(kept).toEqual([onMainnet, onPolygon])
  })
})

describe('asRecord', () => {
  it('returns a plain object unchanged', () => {
    const record = { a: 1 }
    expect(asRecord(record)).toBe(record)
  })

  it('refuses an array, because a list is not a record here', () => {
    expect(asRecord([1, 2, 3])).toBeNull()
  })

  it('refuses null and non-object values', () => {
    expect(asRecord(null)).toBeNull()
    expect(asRecord('a string')).toBeNull()
    expect(asRecord(42)).toBeNull()
  })
})

describe('presentText', () => {
  it('trims surrounding whitespace from a real value', () => {
    expect(presentText('  hello  ')).toBe('hello')
  })

  it('treats a whitespace-only string as absent', () => {
    expect(presentText('   ')).toBeNull()
  })

  it('treats a non-string value as absent, so it can never become the word "undefined"', () => {
    expect(presentText(undefined)).toBeNull()
    expect(presentText(123)).toBeNull()
  })
})

describe('wholeNumber', () => {
  it('reads a whole number given directly', () => {
    expect(wholeNumber(6)).toBe(6)
  })

  it('reads a whole number given as digits in a string', () => {
    expect(wholeNumber('6')).toBe(6)
  })

  it('treats a blank string as absent rather than as zero', () => {
    // Number('') is 0 in the language itself, which would make an absent
    // field indistinguishable from a token that truly declares zero.
    expect(wholeNumber('')).toBeNull()
    expect(wholeNumber('   ')).toBeNull()
  })

  it('treats a fractional string as unreadable', () => {
    expect(wholeNumber('6.5')).toBeNull()
  })

  it('treats null and other non-number, non-string values as absent', () => {
    expect(wholeNumber(null)).toBeNull()
    expect(wholeNumber(undefined)).toBeNull()
    expect(wholeNumber(true)).toBeNull()
  })
})

describe('isWholeAtLeastZero', () => {
  it('accepts zero and positive whole numbers', () => {
    expect(isWholeAtLeastZero(0)).toBe(true)
    expect(isWholeAtLeastZero(5)).toBe(true)
  })

  it('rejects negative numbers, fractions, and non-numbers', () => {
    expect(isWholeAtLeastZero(-1)).toBe(false)
    expect(isWholeAtLeastZero(1.5)).toBe(false)
    expect(isWholeAtLeastZero('5')).toBe(false)
  })
})
