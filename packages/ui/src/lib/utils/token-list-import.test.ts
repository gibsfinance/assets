import { describe, expect, it } from 'vitest'
import { readToken, readTokenList } from './token-list-import'

// This module reads three sources, and none of them can be trusted: a list
// from the server, a list from any address the user types, and pasted
// text. Every test below feeds malformed or hostile input on purpose,
// because that is the normal case for this parser, not the edge case.

describe('readToken', () => {
  it('keeps a token with zero decimals at zero, because rewriting it to eighteen moves every downstream amount by a factor of ten to the eighteenth', () => {
    // The code this module replaced used `Number(t.decimals || 18)`. The `||`
    // operator treats zero as missing, so a token that legitimately declares
    // zero decimals was silently given eighteen instead. A regression here
    // does not change how a number looks on screen; it changes what the
    // number means, and every balance and every transfer computed from it
    // becomes wrong by eighteen orders of magnitude.
    const result = readToken({ address: '0xabc', decimals: 0 }, 0)
    expect(result).not.toHaveProperty('reason')
    expect((result as { decimals: number }).decimals).toBe(0)
  })

  it('keeps a token with chain id zero at zero, rather than defaulting it to chain one', () => {
    // A chain id of zero is a real, if unusual, declared value. Falling back
    // to the default chain would attach the token to the wrong network, and
    // any address computed or checked against that network would be wrong.
    const result = readToken({ address: '0xabc', chainId: 0 }, 0)
    expect(result).not.toHaveProperty('reason')
    expect((result as { chainId: number }).chainId).toBe(0)
  })

  it('reads a complete, well-formed token with every field intact', () => {
    const result = readToken(
      {
        chainId: 369,
        address: '0x1234567890abcdef',
        name: 'Wrapped Pulse',
        symbol: 'WPLS',
        decimals: 8,
        logoURI: 'https://example.com/wpls.png',
      },
      3,
    )
    expect(result).toEqual({
      chainId: 369,
      address: '0x1234567890abcdef',
      name: 'Wrapped Pulse',
      symbol: 'WPLS',
      decimals: 8,
      imageUri: 'https://example.com/wpls.png',
      order: 3,
    })
  })

  it('defaults a missing decimals field to eighteen', () => {
    // Contrast with the `decimals: 0` test above: an omitted field and a
    // supplied zero are different facts, and only the first one should fall
    // back to the default.
    const result = readToken({ address: '0xabc' }, 0)
    expect((result as { decimals: number }).decimals).toBe(18)
  })

  it('defaults a missing chain id field to one', () => {
    // Contrast with the `chainId: 0` test above: an omitted field defaults,
    // a supplied zero does not.
    const result = readToken({ address: '0xabc' }, 0)
    expect((result as { chainId: number }).chainId).toBe(1)
  })

  it('reads decimals and chain id supplied as numeric strings, because real token lists send numbers as strings', () => {
    const result = readToken({ address: '0xabc', decimals: '6', chainId: '369' }, 0)
    expect(result).toEqual({
      chainId: 369,
      address: '0xabc',
      name: '',
      symbol: '',
      decimals: 6,
      order: 0,
    })
  })

  it('falls back to the default decimals when the field is an empty string, rather than reading it as zero', () => {
    // `Number('')` is 0 in plain JavaScript. Treating an empty string as
    // "zero decimals" would repeat the exact class of bug this module was
    // built to fix, so an absent value and a blank value must land the
    // same way: on the default.
    const result = readToken({ address: '0xabc', decimals: '' }, 0)
    expect((result as { decimals: number }).decimals).toBe(18)
  })

  it('falls back to the default decimals for a non-numeric string, and the result stays a finite number', () => {
    const result = readToken({ address: '0xabc', decimals: 'abc' }, 0)
    expect((result as { decimals: number }).decimals).toBe(18)
    expect(Number.isFinite((result as { decimals: number }).decimals)).toBe(true)
  })

  it('falls back to the default decimals for a literal NaN value, and the result stays a finite number', () => {
    const result = readToken({ address: '0xabc', decimals: NaN }, 0)
    expect((result as { decimals: number }).decimals).toBe(18)
    expect(Number.isFinite((result as { decimals: number }).decimals)).toBe(true)
  })

  it('falls back to the default decimals for Infinity, and the result stays a finite number', () => {
    const result = readToken({ address: '0xabc', decimals: Infinity }, 0)
    expect((result as { decimals: number }).decimals).toBe(18)
    expect(Number.isFinite((result as { decimals: number }).decimals)).toBe(true)
  })

  it('rejects a negative decimals count, with a reason that names the allowed range', () => {
    // Decimals is the exponent in `10 ** decimals`. A negative exponent
    // divides an amount instead of scaling it up, so a token that declares
    // `decimals: -1` would read every balance and transfer as one tenth of
    // its true size. That is not a value to round or clamp; it must be
    // refused.
    const result = readToken({ address: '0xabc', decimals: -1 }, 0)
    expect(result).toEqual({ reason: 'decimals -1 is outside 0 to 255' })
  })

  it('rejects a fractional decimals count, because a token cannot declare half a decimal place', () => {
    const result = readToken({ address: '0xabc', decimals: 2.5 }, 0)
    expect(result).toEqual({ reason: 'decimals 2.5 is outside 0 to 255' })
  })

  it('rejects decimals one past the ceiling and accepts decimals at the ceiling, because the standard stores decimals in an unsigned eight-bit field', () => {
    // The boundary itself is the claim, so both sides of it are checked here.
    const tooHigh = readToken({ address: '0xabc', decimals: 256 }, 0)
    expect(tooHigh).toEqual({ reason: 'decimals 256 is outside 0 to 255' })

    const atCeiling = readToken({ address: '0xabc', decimals: 255 }, 0)
    expect(atCeiling).not.toHaveProperty('reason')
    expect((atCeiling as { decimals: number }).decimals).toBe(255)
  })

  it('still accepts decimals of zero now that the range guard exists, because that is the case this module must never break', () => {
    const result = readToken({ address: '0xabc', decimals: 0 }, 0)
    expect(result).not.toHaveProperty('reason')
    expect((result as { decimals: number }).decimals).toBe(0)
  })

  it('rejects a negative chain identifier, with a reason', () => {
    const result = readToken({ address: '0xabc', chainId: -5 }, 0)
    expect(result).toEqual({ reason: 'chain identifier -5 is not a whole number of zero or more' })
  })

  it('rejects a fractional chain identifier, with a reason', () => {
    const result = readToken({ address: '0xabc', chainId: 1.5 }, 0)
    expect(result).toEqual({ reason: 'chain identifier 1.5 is not a whole number of zero or more' })
  })

  it('still accepts a chain identifier of zero now that the range guard exists', () => {
    const result = readToken({ address: '0xabc', chainId: 0 }, 0)
    expect(result).not.toHaveProperty('reason')
    expect((result as { chainId: number }).chainId).toBe(0)
  })

  it('rejects a token with no address, with a reason, instead of writing the text "undefined" as the address', () => {
    // `String(undefined)` is the six-character word "undefined". A token
    // carrying that as its address looks like real data, which is worse
    // than a token that is plainly missing one.
    const result = readToken({ name: 'Nameless' }, 0)
    expect(result).toEqual({ reason: 'no address' })
  })

  it('rejects an address that is only whitespace', () => {
    const result = readToken({ address: '   ' }, 0)
    expect(result).toEqual({ reason: 'no address' })
  })

  it('trims a padded address down to its real value', () => {
    const result = readToken({ address: '  0xabc  ' }, 0)
    expect((result as { address: string }).address).toBe('0xabc')
  })

  it('sets imageUri from logoURI when logoURI is present', () => {
    const result = readToken({ address: '0xabc', logoURI: 'https://example.com/a.png' }, 0)
    expect((result as { imageUri: string }).imageUri).toBe('https://example.com/a.png')
  })

  it('leaves imageUri off the token entirely when logoURI is absent', () => {
    // `not.toHaveProperty` checks the key itself is missing. A check against
    // `toBeUndefined()` would also pass for `{ imageUri: undefined }`, and
    // that difference matters: a serialized object keeps an explicit
    // `undefined` out of JSON either way, but code that does
    // `'imageUri' in token` or spreads defaults over the object sees a
    // different shape depending on which one actually happened.
    const result = readToken({ address: '0xabc' }, 0)
    expect(result).not.toHaveProperty('imageUri')
  })

  it('leaves imageUri off the token entirely when logoURI is an empty string', () => {
    const result = readToken({ address: '0xabc', logoURI: '' }, 0)
    expect(result).not.toHaveProperty('imageUri')
  })

  it('rejects null as "not an object"', () => {
    expect(readToken(null, 0)).toEqual({ reason: 'not an object' })
  })

  it('rejects an array as "not an object"', () => {
    expect(readToken(['0xabc'], 0)).toEqual({ reason: 'not an object' })
  })

  it('rejects a bare string as "not an object"', () => {
    expect(readToken('0xabc', 0)).toEqual({ reason: 'not an object' })
  })

  it('rejects a bare number as "not an object"', () => {
    expect(readToken(42, 0)).toEqual({ reason: 'not an object' })
  })

  it('reads a numeric address as text, because a malformed list may send a number where a string belongs', () => {
    const result = readToken({ address: 123 }, 0)
    expect((result as { address: string }).address).toBe('123')
  })

  it('reads a bigint address as text, for the same reason a plain number is accepted', () => {
    const result = readToken({ address: 123n }, 0)
    expect((result as { address: string }).address).toBe('123')
  })

  it('defaults name and symbol to empty strings when they are absent', () => {
    const result = readToken({ address: '0xabc' }, 0)
    expect((result as { name: string; symbol: string }).name).toBe('')
    expect((result as { name: string; symbol: string }).symbol).toBe('')
  })
})

describe('readTokenList', () => {
  it('returns an empty result for input that is not an array, rather than throwing', () => {
    expect(readTokenList(null)).toEqual({ tokens: [], rejected: [] })
    expect(readTokenList(undefined)).toEqual({ tokens: [], rejected: [] })
    expect(readTokenList('not an array')).toEqual({ tokens: [], rejected: [] })
    expect(readTokenList({ tokens: [] })).toEqual({ tokens: [], rejected: [] })
    expect(readTokenList(42)).toEqual({ tokens: [], rejected: [] })
  })

  it('assigns order to match array position for a clean list', () => {
    const result = readTokenList([{ address: '0xa' }, { address: '0xb' }, { address: '0xc' }])
    expect(result.tokens.map((token) => token.order)).toEqual([0, 1, 2])
  })

  it('keeps the good tokens and reports the bad one by its original position, without leaving a hole in the surviving order values', () => {
    // A single bad entry in a four-hundred-token list must not cost the
    // user the other three hundred and ninety-nine. This test asserts two
    // separate claims, and both must hold independently:
    //   1. the rejection records index 1, the entry's place in the raw array
    //   2. the two surviving tokens are numbered 0 and 1, contiguously, not
    //      0 and 2 with a gap where the bad entry used to be
    const result = readTokenList([{ address: '0xfirst' }, { name: 'no address here' }, { address: '0xthird' }])

    expect(result.tokens).toHaveLength(2)
    expect(result.rejected).toEqual([{ index: 1, reason: 'no address' }])

    expect(result.tokens[0].address).toBe('0xfirst')
    expect(result.tokens[1].address).toBe('0xthird')
    expect(result.tokens.map((token) => token.order)).toEqual([0, 1])
  })

  it('keeps the good tokens around one rejected for its decimals, and records the rejection at its original index', () => {
    const result = readTokenList([{ address: '0xfirst' }, { address: '0xbad', decimals: -1 }, { address: '0xthird' }])

    expect(result.tokens).toHaveLength(2)
    expect(result.tokens.map((token) => token.address)).toEqual(['0xfirst', '0xthird'])
    expect(result.rejected).toEqual([{ index: 1, reason: 'decimals -1 is outside 0 to 255' }])
  })

  it('never produces a token whose address is the literal text "undefined" or "null"', () => {
    const result = readTokenList([{ address: undefined }, { address: null }, {}, { address: '0xreal' }])
    expect(result.tokens.every((token) => token.address !== 'undefined')).toBe(true)
    expect(result.tokens.every((token) => token.address !== 'null')).toBe(true)
    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0].address).toBe('0xreal')
  })
})
