import { describe, it, expect } from 'vitest'
import { COMPACT_FIELDS, parseTokensFormat, toCompactBody } from './compact'
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
