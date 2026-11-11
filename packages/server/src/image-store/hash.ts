import { createHash } from 'node:crypto'

/** A lowercase sha256 digest in hexadecimal: exactly 64 characters from `0-9a-f`. */
export const SHA256_PATTERN = /^[0-9a-f]{64}$/

/**
 * Whether a value is a well-formed sha256 digest.
 *
 * Every store path is built from a digest, so anything that is not exactly 64 lowercase
 * hexadecimal characters (`../`, upper case, a short prefix) must be refused before it
 * reaches a path.
 *
 * @param value Anything.
 * @returns True when `value` is a string of 64 lowercase hexadecimal characters.
 */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

/**
 * Throws unless a value is a well-formed sha256 digest.
 *
 * @param value The digest to check.
 * @returns The same value, now known to be a digest.
 * @throws TypeError naming the problem, without echoing the value into a path or a log line.
 */
export function assertSha256Hex(value: unknown): string {
  if (!isSha256Hex(value)) throw new TypeError('expected a sha256 digest: 64 lowercase hexadecimal characters')
  return value
}

/**
 * The sha256 digest of the exact bytes that are stored.
 *
 * The digest covers the bytes on disk, not the image they decode to: two encodings of one
 * picture have two digests, and one byte string has one digest everywhere.
 *
 * @param bytes The content.
 * @returns The digest as 64 lowercase hexadecimal characters.
 */
export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
