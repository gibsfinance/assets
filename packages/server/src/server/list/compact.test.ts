import { describe, it, expect } from 'vitest'
import { COMPACT_FIELDS, parseCompactFields, parseTokensFormat, toCompactBody } from './compact'
import { decodeCompactBody } from './__testing__/decode-compact'

const token = (symbol: string, sources?: string[]) => ({
  chainId: 1,
  chainIdentifier: 'eip155-1',
  address: `0x${symbol.toLowerCase().padEnd(40, '0')}`,
  name: `${symbol} Token`,
  symbol,
  decimals: 18,
  logoURI: `https://gib.show/image/direct/${symbol}.png`,
  ...(sources ? { sources } : {}),
})

const defaultBody = {
  chainId: 1,
  chainIdentifier: 'eip155-1',
  total: 40,
  tokens: [
    token('AAA', ['lifi/chain-1', 'uniswap/default']),
    token('BBB', ['uniswap/default']),
    token('CCC'),
    token('DDD', ['lifi/chain-1']),
  ],
}

describe('toCompactBody', () => {
  it('decodes back to exactly the default tokens, in order, from fields and sources alone', () => {
    // A client has only the response. If the round trip loses a value or reorders a
    // token, every consumer of the compact format silently shows wrong data.
    expect(decodeCompactBody(toCompactBody(defaultBody))).toEqual(defaultBody)
  })

  it('keeps the total of the whole list, which is larger than the rows sent', () => {
    expect(JSON.parse(toCompactBody(defaultBody)).total).toBe(40)
  })

  it('sends each distinct source once, in order of first use', () => {
    expect(JSON.parse(toCompactBody(defaultBody)).sources).toEqual(['lifi/chain-1', 'uniswap/default'])
  })

  it('refers to sources by index and leaves a token with none as an empty array', () => {
    const { tokens } = JSON.parse(toCompactBody(defaultBody))
    expect(tokens.map((row: unknown[]) => row[5])).toEqual([[0, 1], [1], [], [0]])
  })

  it('declares the field order the rows follow, and leaves the per-row chain out', () => {
    const compact = JSON.parse(toCompactBody(defaultBody))
    expect(compact.format).toBe('compact')
    expect(compact.fields).toEqual([...COMPACT_FIELDS])
    expect(compact.tokens[0]).toEqual([
      defaultBody.tokens[0].address,
      'AAA Token',
      'AAA',
      18,
      'https://gib.show/image/direct/AAA.png',
      [0, 1],
    ])
  })

  it('encodes an empty list', () => {
    const empty = { chainId: 1, chainIdentifier: 'eip155-1', total: 0, tokens: [] }
    expect(decodeCompactBody(toCompactBody(empty))).toEqual(empty)
  })
})

describe('parseTokensFormat', () => {
  it('treats an absent parameter as the default body', () => {
    expect(parseTokensFormat(undefined)).toBe('default')
  })

  it('accepts compact', () => {
    expect(parseTokensFormat('compact')).toBe('compact')
  })

  it.each(['csv', '', 'COMPACT', ['compact', 'compact'], 1])('rejects %j with 400', (value) => {
    expect(() => parseTokensFormat(value)).toThrow(expect.objectContaining({ status: 400 }))
  })
})

describe('toCompactBody with a field selection', () => {
  const selection = ['address', 'name', 'symbol', 'decimals', 'sources'] as const
  const withoutLogo = (body: ReturnType<typeof decodeCompactBody>) => ({
    ...body,
    tokens: body.tokens.map(({ logoURI: _logoURI, ...rest }) => rest),
  })

  it('decodes to the full body minus the fields left out', () => {
    // Dropping logoURI must lose nothing else; a client reads the rest by name.
    const decoded = decodeCompactBody(toCompactBody(defaultBody, selection))
    expect(decoded).toEqual(withoutLogo(defaultBody))
  })

  it('echoes the selected fields and sends rows of exactly that width', () => {
    const compact = JSON.parse(toCompactBody(defaultBody, selection))
    expect(compact.fields).toEqual(selection)
    expect(compact.tokens.every((row: unknown[]) => row.length === selection.length)).toBe(true)
  })

  it('leaves out the top-level sources array when sources is not selected', () => {
    const compact = JSON.parse(toCompactBody(defaultBody, ['address', 'symbol']))
    expect(compact).not.toHaveProperty('sources')
    expect(compact.tokens[0]).toEqual([defaultBody.tokens[0].address, 'AAA'])
  })

  it('keeps the full row when no selection is given', () => {
    expect(toCompactBody(defaultBody)).toBe(toCompactBody(defaultBody, COMPACT_FIELDS))
  })
})

describe('parseCompactFields', () => {
  it('returns every field when the parameter is absent, for either format', () => {
    expect(parseCompactFields(undefined, 'compact')).toEqual([...COMPACT_FIELDS])
    expect(parseCompactFields(undefined, 'default')).toEqual([...COMPACT_FIELDS])
  })

  it('normalizes any requested order to the canonical order', () => {
    // Two spellings of one selection must share one cache key and one body.
    expect(parseCompactFields('symbol,address', 'compact')).toEqual(['address', 'symbol'])
    expect(parseCompactFields('address,symbol', 'compact')).toEqual(['address', 'symbol'])
  })

  it.each([
    ['without format=compact', 'address,name', 'default'],
    ['without address', 'name,symbol', 'compact'],
    ['with an unknown name', 'address,price', 'compact'],
    ['with a repeated name', 'address,name,address', 'compact'],
    ['empty', '', 'compact'],
    ['given twice', ['address', 'name'], 'compact'],
  ] as const)('rejects a selection %s with 400', (_label, value, format) => {
    expect(() => parseCompactFields(value, format)).toThrow(expect.objectContaining({ status: 400 }))
  })
})
