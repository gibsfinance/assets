import { describe, it, expect } from 'vitest'
import { isLinkOnlyHost } from './link-only-hosts'

describe('isLinkOnlyHost', () => {
  it('recognizes a DeBank-hosted address', () => {
    expect(isLinkOnlyHost('https://static.debank.com/image/token/logo_url/eth/abc.png')).toBe(true)
  })

  it('matches over plain http as well as https', () => {
    expect(isLinkOnlyHost('http://static.debank.com/image/token/logo_url/eth/abc.png')).toBe(true)
  })

  it('is case-insensitive on the host, the way hostnames are', () => {
    expect(isLinkOnlyHost('https://STATIC.DEBANK.COM/image/token/logo_url/eth/abc.png')).toBe(true)
  })

  it('leaves an ordinary host alone', () => {
    expect(isLinkOnlyHost('https://assets.coingecko.com/coins/images/1/large/bitcoin.png')).toBe(false)
  })

  it('does not match an address that merely mentions the host in its query string', () => {
    // A substring test would catch this; a hostname test must not. The address
    // is genuinely served by tracking.example.com — static.debank.com appears
    // only as a value the tracker happens to carry.
    expect(isLinkOnlyHost('https://tracking.example.com/click?dest=https://static.debank.com/x.png')).toBe(false)
  })

  it('does not match a subdomain that merely contains the host as a suffix of its own label', () => {
    // A different, unrelated host that happens to end with the same
    // characters is not the same host and must not be treated as one.
    expect(isLinkOnlyHost('https://notstatic.debank.com/x.png')).toBe(false)
  })

  it('rejects a relative submodule path, which cannot name any host', () => {
    expect(isLinkOnlyHost('trustwallet/blockchains/ethereum/assets/0xabc/logo.png')).toBe(false)
  })

  it('rejects a data uri', () => {
    expect(isLinkOnlyHost('data:image/png;base64,abc')).toBe(false)
  })

  it('rejects an ipfs uri', () => {
    expect(isLinkOnlyHost('ipfs://QmHash')).toBe(false)
  })

  it('rejects null and undefined without throwing', () => {
    expect(isLinkOnlyHost(null)).toBe(false)
    expect(isLinkOnlyHost(undefined)).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isLinkOnlyHost('')).toBe(false)
  })

  it('swallows a malformed http(s) address rather than throwing', () => {
    expect(isLinkOnlyHost('https://')).toBe(false)
  })
})
