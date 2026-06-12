/**
 * @module url-guard
 * Server-side request forgery protection for user-supplied URLs the server
 * fetches (token list submissions). Allows only http/https and rejects URLs
 * whose host resolves to private, loopback, link-local, or otherwise
 * non-public addresses (covering cloud metadata endpoints such as
 * 169.254.169.254).
 *
 * Note: resolution happens once at validation time; a hostile DNS server
 * could still rebind between validation and fetch. That residual risk is
 * accepted for this endpoint — the fetch only probes for token-list JSON
 * and never echoes upstream bodies or status codes to clients.
 */
import * as dns from 'node:dns/promises'
import * as net from 'node:net'

/** True when the URL uses an allowed outbound scheme. */
export const isAllowedScheme = (url: URL): boolean => url.protocol === 'http:' || url.protocol === 'https:'

/** True when the dotted-quad IPv4 address is private, loopback, link-local, or otherwise non-public. */
const isPrivateIPv4 = (address: string): boolean => {
  const [a, b] = address.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

/** True when the IPv6 address is loopback, link-local, unique-local, or maps a private IPv4. */
const isPrivateIPv6 = (address: string): boolean => {
  const lower = address.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  const mappedIPv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedIPv4) return isPrivateIPv4(mappedIPv4[1])
  if (/^fe[89ab]/.test(lower)) return true // link-local fe80::/10
  if (/^f[cd]/.test(lower)) return true // unique-local fc00::/7
  return false
}

/** True when the IP address (v4 or v6) must not be fetched from the server. */
export const isPrivateAddress = (address: string): boolean => {
  const family = net.isIP(address)
  if (family === 4) return isPrivateIPv4(address)
  if (family === 6) return isPrivateIPv6(address)
  return true // not an IP at all — treat as unsafe
}

/** Resolve a hostname to all its addresses; empty array when resolution fails. */
const resolveAddresses = async (hostname: string): Promise<string[]> => {
  try {
    const results = await dns.lookup(hostname, { all: true, verbatim: true })
    return results.map((r) => r.address)
  } catch {
    return []
  }
}

export type OutboundUrlValidation = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * Validate a user-supplied URL before the server fetches it.
 *
 * Checks (in order): URL syntax, http/https scheme, and that every resolved
 * address is public (literal IPs are checked directly via net.isIP; hostnames
 * are resolved through dns.lookup so tricks like `http://localhost` or DNS
 * records pointing at 10.0.0.0/8 are caught at the address level).
 */
export const validateOutboundUrl = async (rawUrl: string): Promise<OutboundUrlValidation> => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }

  if (!isAllowedScheme(url)) {
    return { ok: false, reason: 'Only http and https URLs are allowed' }
  }

  // URL.hostname wraps IPv6 literals in brackets — strip them for net.isIP
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(hostname) ? [hostname] : await resolveAddresses(hostname)

  if (addresses.length === 0) {
    return { ok: false, reason: 'URL hostname could not be resolved' }
  }
  if (addresses.some(isPrivateAddress)) {
    return { ok: false, reason: 'URL resolves to a private or internal address' }
  }

  return { ok: true, url }
}
