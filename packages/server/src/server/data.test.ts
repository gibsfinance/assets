import { describe, expect, it } from 'vitest'
import { allTokenLists, providerToListLink } from './data'

describe('providerToListLink', () => {
  it('returns the same module-level map on every call, so writes from one caller are visible to another', () => {
    const first = providerToListLink()
    first.set('trustwallet', 'https://example.com/trustwallet.json')

    const second = providerToListLink()

    // If this ever started constructing a fresh Map per call, the write above
    // would be invisible here and provider->list links would never accumulate.
    expect(second).toBe(first)
    expect(second.get('trustwallet')).toBe('https://example.com/trustwallet.json')
  })
})

describe('allTokenLists', () => {
  it('starts as an empty list', () => {
    expect(allTokenLists).toEqual([])
  })
})
