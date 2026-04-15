import { describe, it, expect } from 'vitest'
import { toCAIP2, fromCAIP2, namespaceOf, isBareNumeric } from './chain-id'

describe('toCAIP2', () => {
  it('prefixes EVM chain IDs with eip155', () => {
    expect(toCAIP2('1')).toBe('eip155-1')
    expect(toCAIP2('369')).toBe('eip155-369')
    expect(toCAIP2('56')).toBe('eip155-56')
    expect(toCAIP2('8453')).toBe('eip155-8453')
  })

  it('maps chain 0 to asset-0', () => {
    expect(toCAIP2('0')).toBe('asset-0')
  })

  it('passes through values that already have a dash (CAIP-2 format)', () => {
    expect(toCAIP2('eip155-369')).toBe('eip155-369')
    expect(toCAIP2('asset-0')).toBe('asset-0')
    expect(toCAIP2('solana-mainnet')).toBe('solana-mainnet')
  })
})

describe('fromCAIP2', () => {
  it('extracts the reference from EVM CAIP-2 strings', () => {
    expect(fromCAIP2('eip155-369')).toBe('369')
    expect(fromCAIP2('eip155-1')).toBe('1')
    expect(fromCAIP2('eip155-56')).toBe('56')
  })

  it('extracts the reference from asset namespace', () => {
    expect(fromCAIP2('asset-0')).toBe('0')
  })

  it('passes through bare numbers', () => {
    expect(fromCAIP2('369')).toBe('369')
    expect(fromCAIP2('0')).toBe('0')
  })
})

describe('namespaceOf', () => {
  it('extracts namespace from CAIP-2 strings', () => {
    expect(namespaceOf('eip155-369')).toBe('eip155')
    expect(namespaceOf('asset-0')).toBe('asset')
    expect(namespaceOf('solana-mainnet')).toBe('solana')
  })

  it('defaults to eip155 for bare numbers', () => {
    expect(namespaceOf('369')).toBe('eip155')
    expect(namespaceOf('1')).toBe('eip155')
  })
})

describe('isBareNumeric', () => {
  it('returns true for numeric strings', () => {
    expect(isBareNumeric('369')).toBe(true)
    expect(isBareNumeric('0')).toBe(true)
  })

  it('returns false for CAIP-2 strings', () => {
    expect(isBareNumeric('eip155-369')).toBe(false)
    expect(isBareNumeric('asset-0')).toBe(false)
  })

  it('returns false for empty or non-numeric', () => {
    expect(isBareNumeric('')).toBe(false)
    expect(isBareNumeric('abc')).toBe(false)
  })
})
