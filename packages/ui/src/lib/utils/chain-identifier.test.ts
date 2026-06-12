/**
 * The UI must emit the exact identifier format the server canonicalizes to
 * (packages/server/src/chain-id.ts toCAIP2) — drift here would fork CDN cache
 * entries and produce copyable URLs the docs don't match.
 */
import { describe, it, expect } from 'vitest'
import { toChainIdentifier, fromChainIdentifier, prefixImagePath } from './chain-identifier'

describe('toChainIdentifier', () => {
  it('prefixes bare EVM chain ids', () => {
    expect(toChainIdentifier('369')).toBe('eip155-369')
    expect(toChainIdentifier(1)).toBe('eip155-1')
  })

  it('maps chain 0 to the asset namespace, matching the server', () => {
    expect(toChainIdentifier('0')).toBe('asset-0')
    expect(toChainIdentifier(0)).toBe('asset-0')
  })

  it('passes already-prefixed identifiers through unchanged', () => {
    expect(toChainIdentifier('eip155-369')).toBe('eip155-369')
    expect(toChainIdentifier('asset-0')).toBe('asset-0')
    expect(toChainIdentifier('solana-mainnet')).toBe('solana-mainnet')
  })
})

describe('fromChainIdentifier', () => {
  it('extracts the bare reference from a prefixed identifier', () => {
    expect(fromChainIdentifier('eip155-369')).toBe('369')
    expect(fromChainIdentifier('asset-0')).toBe('0')
  })

  it('passes bare numerics through so either form is accepted', () => {
    expect(fromChainIdentifier('369')).toBe('369')
  })

  it('round-trips with toChainIdentifier', () => {
    expect(fromChainIdentifier(toChainIdentifier('943'))).toBe('943')
  })
})

describe('prefixImagePath', () => {
  it('prefixes the chain segment of a token image path', () => {
    expect(prefixImagePath('/image/1/0xabc')).toBe('/image/eip155-1/0xabc')
  })

  it('prefixes a network-only image path', () => {
    expect(prefixImagePath('/image/369')).toBe('/image/eip155-369')
  })

  it('leaves already-prefixed and non-image paths untouched', () => {
    expect(prefixImagePath('/image/eip155-1/0xabc')).toBe('/image/eip155-1/0xabc')
    expect(prefixImagePath('/list/tokens/369')).toBe('/list/tokens/369')
  })
})
