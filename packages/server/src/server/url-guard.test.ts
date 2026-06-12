/**
 * Tests for the outbound URL guard (server-side request forgery protection).
 *
 * Why these matter: POST /api/lists/submit fetches a user-supplied URL from
 * the server. Without these checks the endpoint could be used to reach cloud
 * metadata services (169.254.169.254), localhost-only admin interfaces, or
 * private network hosts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const lookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}))

import { isAllowedScheme, isPrivateAddress, validateOutboundUrl } from './url-guard'

describe('isAllowedScheme', () => {
  it('allows http and https', () => {
    expect(isAllowedScheme(new URL('http://example.com'))).toBe(true)
    expect(isAllowedScheme(new URL('https://example.com'))).toBe(true)
  })

  it('rejects ftp, file, and other schemes', () => {
    expect(isAllowedScheme(new URL('ftp://example.com'))).toBe(false)
    expect(isAllowedScheme(new URL('file:///etc/passwd'))).toBe(false)
    expect(isAllowedScheme(new URL('gopher://example.com'))).toBe(false)
  })
})

describe('isPrivateAddress', () => {
  it('flags loopback, private ranges, link-local, and metadata addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.255')).toBe(true)
    expect(isPrivateAddress('192.168.1.1')).toBe(true)
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('255.255.255.255')).toBe(true)
  })

  it('flags IPv6 loopback, link-local, unique-local, and mapped private IPv4', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('::')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
    expect(isPrivateAddress('fd00::1')).toBe(true)
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true)
  })

  it('passes public addresses', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false)
    expect(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
  })

  it('treats non-IP strings as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
  })
})

describe('validateOutboundUrl', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  it('rejects malformed URLs', async () => {
    const result = await validateOutboundUrl('not-a-url')
    expect(result).toEqual({ ok: false, reason: 'Invalid URL' })
  })

  it('rejects non-http(s) schemes', async () => {
    const result = await validateOutboundUrl('ftp://example.com/list.json')
    expect(result).toEqual({ ok: false, reason: 'Only http and https URLs are allowed' })
  })

  it('rejects literal metadata, loopback, and private IPs without resolving', async () => {
    for (const url of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:8080/', 'http://10.0.0.1/x']) {
      const result = await validateOutboundUrl(url)
      expect(result.ok, url).toBe(false)
      if (!result.ok) expect(result.reason).toBe('URL resolves to a private or internal address')
    }
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects bracketed IPv6 loopback literals', async () => {
    const result = await validateOutboundUrl('http://[::1]:8080/')
    expect(result).toEqual({ ok: false, reason: 'URL resolves to a private or internal address' })
  })

  it('rejects hostnames that resolve to private addresses (e.g. localhost)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    const result = await validateOutboundUrl('http://localhost:3456/list.json')
    expect(result).toEqual({ ok: false, reason: 'URL resolves to a private or internal address' })
  })

  it('rejects hostnames where any resolved address is private (DNS pointing inside)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    const result = await validateOutboundUrl('https://evil.example.com/list.json')
    expect(result).toEqual({ ok: false, reason: 'URL resolves to a private or internal address' })
  })

  it('rejects unresolvable hostnames', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await validateOutboundUrl('https://does-not-exist.example/list.json')
    expect(result).toEqual({ ok: false, reason: 'URL hostname could not be resolved' })
  })

  it('accepts public hostnames', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
    const result = await validateOutboundUrl('https://example.com/list.json')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url.hostname).toBe('example.com')
  })
})
