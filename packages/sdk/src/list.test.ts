import { describe, it, expect } from 'vitest'
import { getTokenListUrl, getNetworksUrl, getListIndexUrl } from './list'

describe('getTokenListUrl', () => {
  it('builds list URL without chainId', () => {
    expect(getTokenListUrl('https://gib.show', 'piteas', 'exchange')).toBe('https://gib.show/list/piteas/exchange')
  })

  it('adds chainId param', () => {
    expect(getTokenListUrl('https://gib.show', 'piteas', 'exchange', 369)).toBe('https://gib.show/list/piteas/exchange?chainId=369')
  })
})

describe('getNetworksUrl', () => {
  it('builds networks URL', () => {
    expect(getNetworksUrl('https://gib.show')).toBe('https://gib.show/networks')
  })
})

describe('getListIndexUrl', () => {
  it('builds list index URL', () => {
    expect(getListIndexUrl('https://gib.show')).toBe('https://gib.show/list')
  })
})
