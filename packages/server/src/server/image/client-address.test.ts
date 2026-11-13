import { describe, it, expect } from 'vitest'
import { clientAddressOf, isPrivateAddress } from './client-address'

const request = (ip: string | undefined, headers: Record<string, string | string[] | undefined> = {}) => ({
  ip,
  headers,
})

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.0.5',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
  ])('treats %s as a private address', (address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '172.15.0.1', '172.32.0.1', '203.0.113.7', '2001:db8::1', '2606:4700::1', '::ffff:8.8.8.8'])(
    'treats %s as a public address',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false)
    },
  )

  it('treats text that is not an address as not private', () => {
    expect(isPrivateAddress('not an address')).toBe(false)
  })
})

describe('clientAddressOf', () => {
  it('names a caller by its public address', () => {
    expect(clientAddressOf(request('203.0.113.7'))).toBe('203.0.113.7')
  })

  it('names a caller by an IPv4-mapped public address without the prefix', () => {
    expect(clientAddressOf(request('::ffff:203.0.113.7'))).toBe('203.0.113.7')
  })

  it('names no caller when the connection comes from a private address, which is a proxy or a tunnel', () => {
    expect(clientAddressOf(request('172.18.0.4'))).toBeNull()
    expect(clientAddressOf(request('::ffff:127.0.0.1'))).toBeNull()
  })

  it('names no caller when the connection has no address', () => {
    expect(clientAddressOf(request(undefined))).toBeNull()
  })

  it('ignores a client address header unless the operator named it', () => {
    const forged = { 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.2' }
    expect(clientAddressOf(request('172.18.0.4', forged))).toBeNull()
    expect(clientAddressOf(request('203.0.113.7', forged))).toBe('203.0.113.7')
  })

  it('reads the named header, whatever the connection says', () => {
    const headers = { 'cf-connecting-ip': '198.51.100.1' }
    expect(clientAddressOf(request('172.18.0.4', headers), { header: 'cf-connecting-ip' })).toBe('198.51.100.1')
    expect(clientAddressOf(request('203.0.113.7', headers), { header: 'CF-Connecting-IP' })).toBe('198.51.100.1')
  })

  it('takes the first value of a header sent more than once', () => {
    const headers = { 'cf-connecting-ip': [' 198.51.100.1 ', '198.51.100.2'] }
    expect(clientAddressOf(request('172.18.0.4', headers), { header: 'cf-connecting-ip' })).toBe('198.51.100.1')
  })

  it('falls back to the connection when the named header is missing or is not an address', () => {
    expect(clientAddressOf(request('203.0.113.7'), { header: 'cf-connecting-ip' })).toBe('203.0.113.7')
    const text = { 'cf-connecting-ip': 'attacker-chosen-text' }
    expect(clientAddressOf(request('203.0.113.7', text), { header: 'cf-connecting-ip' })).toBe('203.0.113.7')
    expect(clientAddressOf(request('172.18.0.4', text), { header: 'cf-connecting-ip' })).toBeNull()
  })

  it('names an IPv6 caller by its first 64 bits, so one block is one caller', () => {
    const first = clientAddressOf(request('2001:db8:1:2:aaaa:bbbb:cccc:dddd'))
    const second = clientAddressOf(request('2001:db8:1:2::1'))
    const other = clientAddressOf(request('2001:db8:1:3::1'))
    expect(first).toBe('2001:0db8:0001:0002::/64')
    expect(second).toBe(first)
    expect(other).not.toBe(first)
  })

  it('writes a short IPv6 address in full before cutting it', () => {
    expect(clientAddressOf(request('2001:db8::1'))).toBe('2001:0db8:0000:0000::/64')
    expect(clientAddressOf(request('2606:4700::'))).toBe('2606:4700:0000:0000::/64')
  })
})
