/**
 * @module image-store/encoding
 * Percent-encoding shared by the adapters that put object keys in a web address.
 */

/**
 * Percent-encodes text the way Signature Version 4 requires: everything except letters, digits,
 * `-`, `_`, `.` and `~`.
 *
 * @param text Text to encode.
 */
export const encodeRfc3986 = (text: string): string =>
  encodeURIComponent(text).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * The path of an object key: each segment percent-encoded and the slashes between them kept.
 *
 * @param key An object key such as `sha256/ab/abcd...`.
 */
export const encodeObjectPath = (key: string): string => key.split('/').map(encodeRfc3986).join('/')
