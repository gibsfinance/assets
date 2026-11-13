/**
 * @module image/client-address
 * Names the caller of a request, so a budget can be spent per caller and not only in total.
 *
 * The server does not set Express's `trust proxy`, so `request.ip` is the address of whatever opened
 * the connection. Behind a tunnel or a proxy that is the tunnel's own (private) address, the same
 * for every visitor. Two rules keep this honest:
 *
 * - A header that carries the real client address (for Cloudflare, `cf-connecting-ip`) is read only
 *   when the operator names it in `CLIENT_ADDRESS_HEADER`. Naming it states that the server can be
 *   reached only through that proxy; a header a client could set itself is never trusted by default.
 * - With no header named, a connection from a private, loopback or link-local address is a proxy
 *   whose callers cannot be told apart, so it names no caller (null) and only the global budget
 *   applies. Without this, every visitor behind a tunnel would share one small per-caller budget.
 *
 * An IPv6 address is reduced to its first 64 bits, because one caller usually owns a whole block of
 * that size and could otherwise take a fresh address for every request.
 */
import { isIPv4, isIPv6 } from 'node:net'

/** The part of an Express request this module reads. */
export interface ClientAddressSource {
  ip?: string
  headers: Record<string, string | string[] | undefined>
}

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(?:1[6-9]|2\d|3[01])\./, /^0\./]

/** The address without an IPv6 zone (`%eth0`) and without an IPv4-mapped prefix (`::ffff:`), so one form is judged. */
function unmapIpv4(address: string): string {
  const [withoutZone] = address.split('%')
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(withoutZone)
  return match ? match[1] : withoutZone
}

/** The eight 16-bit groups of an IPv6 address, written out in full. */
function expandIpv6(address: string): string[] {
  const [head, tail = ''] = address.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const missing = address.includes('::') ? 8 - headGroups.length - tailGroups.length : 0
  return [...headGroups, ...Array(missing).fill('0'), ...tailGroups].map((group) =>
    group.toLowerCase().padStart(4, '0'),
  )
}

/** Whether an address belongs to the machine itself or a private network. */
export function isPrivateAddress(address: string): boolean {
  const plain = unmapIpv4(address)
  if (isIPv4(plain)) return PRIVATE_IPV4.some((range) => range.test(plain))
  if (!isIPv6(plain)) return false
  const groups = expandIpv6(plain)
  const [first] = groups
  const isLoopback = groups.join(':') === '0000:0000:0000:0000:0000:0000:0000:0001'
  // fc00::/7 is unique local, fe80::/10 is link local.
  return isLoopback || /^f[cd]/.test(first) || /^fe[89ab]/.test(first)
}

/** One caller's key: an IPv4 address as written, an IPv6 address as its first 64 bits. */
function keyFor(address: string): string {
  const plain = unmapIpv4(address)
  if (!isIPv6(plain)) return plain
  return expandIpv6(plain).slice(0, 4).join(':') + '::/64'
}

/**
 * The key of the caller that made `request`, or null when callers cannot be told apart.
 *
 * @param options.header Lower-case name of the header that carries the real client address, from
 *   `CLIENT_ADDRESS_HEADER`. Absent means no header is trusted.
 */
export function clientAddressOf(request: ClientAddressSource, { header }: { header?: string } = {}): string | null {
  const named = header ? request.headers[header.toLowerCase()] : undefined
  const value = (Array.isArray(named) ? named[0] : named)?.trim()
  // A named header with no usable value falls back to the connection, as if it were not set.
  const plainValue = value ? unmapIpv4(value) : ''
  if (isIPv4(plainValue) || isIPv6(plainValue)) return keyFor(plainValue)
  const peer = request.ip
  if (!peer || isPrivateAddress(peer)) return null
  return keyFor(peer)
}
