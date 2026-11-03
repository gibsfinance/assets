import { describe, it, expect } from 'vitest'
import { decodeCompactTokens, type CompactTokensResponse } from './compact-tokens'
import { compactBody } from '../../../tests/compact-body'

const TOKENS = [
  { address: '0xa', name: 'Alpha', symbol: 'AAA', decimals: 18, sources: ['p/one', 'p/two'] },
  { address: '0xb', name: 'Beta', symbol: 'BBB', decimals: 6, sources: ['p/two'] },
  { address: '0xc', name: 'Gamma', symbol: 'CCC', decimals: 9 },
]

describe('decodeCompactTokens', () => {
  // The server writes each source name once; a row must get the names back.
  it('round-trips default-format tokens, resolving source indexes to names', () => {
    const decoded = decodeCompactTokens(compactBody(1, TOKENS))
    expect(decoded).toEqual(TOKENS.map((token) => ({ ...token, sources: token.sources ?? [] })))
  })

  // Positions are the server's to choose. A decoder that hard-codes them breaks
  // the day the server reorders or inserts a column.
  it('finds each column by name when the fields are reordered', () => {
    const response: CompactTokensResponse = {
      chainId: 1,
      total: 1,
      format: 'compact',
      fields: ['sources', 'decimals', 'symbol', 'name', 'address'],
      sources: ['p/one', 'p/two'],
      tokens: [[[1, 0], 18, 'AAA', 'Alpha', '0xa']],
    }
    expect(decodeCompactTokens(response)).toEqual([
      { address: '0xa', name: 'Alpha', symbol: 'AAA', decimals: 18, sources: ['p/two', 'p/one'] },
    ])
  })

  it('returns no sources for a token whose row holds an empty array', () => {
    const [decoded] = decodeCompactTokens(compactBody(1, [TOKENS[2]]))
    expect(decoded.sources).toEqual([])
  })

  it('returns no sources when the body has no sources column', () => {
    const response: CompactTokensResponse = {
      chainId: 1,
      total: 1,
      format: 'compact',
      fields: ['address', 'name', 'symbol', 'decimals'],
      tokens: [['0xa', 'Alpha', 'AAA', 18]],
    }
    expect(decodeCompactTokens(response)[0].sources).toEqual([])
  })

  it('reads an empty row of sources when the body has no top-level sources array', () => {
    const response: CompactTokensResponse = {
      chainId: 1,
      total: 1,
      format: 'compact',
      fields: ['address', 'name', 'symbol', 'decimals', 'sources'],
      tokens: [['0xa', 'Alpha', 'AAA', 18, []]],
    }
    expect(decodeCompactTokens(response)[0].sources).toEqual([])
  })

  // A server that ignored format=compact answers with the default body. Reading
  // it positionally would produce rows with empty names and raise nothing.
  it('refuses a body that is not in the compact format', () => {
    const defaultBody = { chainId: 1, total: 0, tokens: [] } as unknown as CompactTokensResponse
    expect(() => decodeCompactTokens(defaultBody)).toThrow('expected a compact token list, got format "undefined"')
  })

  it.each(['address', 'name', 'symbol', 'decimals'])('refuses a body without the %s field', (field) => {
    const body = compactBody(1, TOKENS)
    const response = { ...body, fields: body.fields.map((name) => (name === field ? 'other' : name)) }
    expect(() => decodeCompactTokens(response)).toThrow(`lacks required fields: ${field}`)
  })
})
