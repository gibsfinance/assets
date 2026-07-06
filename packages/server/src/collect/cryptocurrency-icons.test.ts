import { describe, it, expect, vi } from 'vitest'
// The module chain (cryptocurrency-icons -> ../db -> ../utils) instantiates the
// Ink terminal renderer at module load, which cannot run under vitest
// (patch-console). An endlessly-chainable no-op stands in. Same pattern as
// src/utils/chain-id-to-network-id.test.ts.
vi.mock('../log/App', () => {
  const noop: any = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
})

import { parseCatalog } from './cryptocurrency-icons'

describe('parseCatalog', () => {
  it('keeps well-formed entries', () => {
    const raw = [
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
      { name: 'Monero', symbol: 'XMR', slug: 'monero', img_url: 'https://h/32/monero.png' },
    ]
    expect(parseCatalog(raw)).toHaveLength(2)
  })

  it('drops entries missing required string fields and non-array input', () => {
    const raw = [
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
      { name: 'Broken', symbol: 'BRK', slug: 'broken' }, // no img_url
      { symbol: 'NON', slug: 'no-name', img_url: 'https://h/32/x.png' }, // no name
    ]
    expect(parseCatalog(raw).map((e) => e.slug)).toEqual(['bitcoin'])
    expect(parseCatalog({ not: 'an array' })).toEqual([])
  })

  it('drops entries whose icon url is not https', () => {
    const raw = [
      { name: 'Bitcoin', symbol: 'BTC', slug: 'bitcoin', img_url: 'https://h/32/bitcoin.png' },
      { name: 'Relative', symbol: 'REL', slug: 'relative', img_url: '/32/relative.png' },
      { name: 'Insecure', symbol: 'INS', slug: 'insecure', img_url: 'http://h/32/insecure.png' },
    ]
    expect(parseCatalog(raw).map((e) => e.slug)).toEqual(['bitcoin'])
  })
})
