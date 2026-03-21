import { describe, it, expect } from 'vitest'
import { toTokenListJson } from './useVCSPublish'
import type { LocalList } from './useLocalLists'

describe('toTokenListJson', () => {
  const makeList = (overrides?: Partial<LocalList>): LocalList => ({
    id: 'test-id',
    name: 'Test List',
    description: 'A test list',
    tokens: [
      {
        chainId: 1,
        address: '0xabc',
        name: 'Token A',
        symbol: 'TKNA',
        decimals: 18,
        imageUri: 'https://example.com/a.png',
        order: 0,
      },
      {
        chainId: 1,
        address: '0xdef',
        name: 'Token B',
        symbol: 'TKNB',
        decimals: 6,
        order: 1,
      },
    ],
    source: { type: 'scratch' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })

  it('produces valid Uniswap token list JSON', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    expect(parsed.name).toBe('Test List')
    expect(parsed.version).toEqual({ major: 1, minor: 0, patch: 0 })
    expect(parsed.tokens).toHaveLength(2)
    expect(parsed.timestamp).toBeDefined()
  })

  it('includes logoURI only when imageUri is set', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    expect(parsed.tokens[0].logoURI).toBe('https://example.com/a.png')
    expect(parsed.tokens[1].logoURI).toBeUndefined()
  })

  it('maps token fields correctly', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    const token = parsed.tokens[0]
    expect(token.chainId).toBe(1)
    expect(token.address).toBe('0xabc')
    expect(token.name).toBe('Token A')
    expect(token.symbol).toBe('TKNA')
    expect(token.decimals).toBe(18)
  })

  it('handles empty token list', () => {
    const json = toTokenListJson(makeList({ tokens: [] }))
    const parsed = JSON.parse(json)
    expect(parsed.tokens).toEqual([])
  })

  it('produces valid JSON string', () => {
    const json = toTokenListJson(makeList())
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('omits internal fields like order and imageUri key name', () => {
    const json = toTokenListJson(makeList())
    const parsed = JSON.parse(json)
    expect(parsed.tokens[0]).not.toHaveProperty('order')
    expect(parsed.tokens[0]).not.toHaveProperty('imageUri')
  })
})
