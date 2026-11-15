/**
 * @module untrusted-input
 * The limit on decoding an image that came from outside the server. A PNG's header states its size before any
 * pixel is decoded, and a small file can state a very large one: a 255 KB palette PNG of 16383 by 16383 pixels
 * decodes for about six seconds. sharp refuses such an input when it reads the header, if it is told the most
 * pixels it may decode. Every sharp call on bytes from outside spreads `UNTRUSTED_INPUT` into its options.
 *
 * This module has no imports beyond the constant, so the sanitizer worker can load it without the server's
 * configuration.
 */

/**
 * The most pixels one image from outside may have when it is decoded: about 5000 by 5000. A logo never needs more.
 * An image over it is refused before it is decoded, and nothing is charged beyond the refusal.
 */
export const MAX_INPUT_PIXELS = 25_000_000

/** The sharp options for bytes from outside. Spread them into `sharp(bytes, options)`. */
export const UNTRUSTED_INPUT = { limitInputPixels: MAX_INPUT_PIXELS } as const
