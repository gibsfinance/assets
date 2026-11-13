/**
 * @module image/headers
 * Response header names that are not about attribution, kept in their own
 * tiny module with no other imports.
 *
 * `app.ts` needs this name to list it in `cors()`'s `exposedHeaders`, and it
 * must do that without pulling in the database and drizzle-orm the way
 * importing it from `handlers.ts` would — the same reason
 * `ATTRIBUTION_HEADER_NAMES` lives in `attribution.ts` rather than in
 * `handlers.ts`. A module that emits a header should not force every reader
 * of that header's name to also load a whole lookup pipeline.
 */

/**
 * Header naming the chain identifier `/image/{chainId}` actually resolved a
 * bare numeric request to, in prefixed form (`eip155-369`). Set only on the
 * success path — see `resolveChainIdAgainstStored` in `chain-id.ts` for how
 * the resolution itself works.
 *
 * Kept separate from `ATTRIBUTION_HEADER_NAMES` rather than folded into it:
 * that constant names headers describing copyright and licence provenance,
 * and this one names a chain-resolution outcome — an unrelated fact that
 * only happens to need the same cross-origin exposure treatment.
 */
export const RESOLVED_CHAIN_HEADER = 'x-resolved-chain'

/**
 * The policy sent with every response that carries image bytes. A stored vector image is text a
 * stranger uploaded, and a browser that opens it directly at `/image/...` runs it on this origin.
 * The sanitizer is a filter, and a filter can be bypassed, so this is the second wall: with
 * `default-src 'none'` and `sandbox`, a script in the file cannot run and the file has no origin to
 * borrow. `img-src data:` and `style-src 'unsafe-inline'` keep the inline pictures and styles that
 * real logos use.
 */
export const IMAGE_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"

/** The headers every image-bytes response carries, as name and value. */
export const IMAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': IMAGE_CONTENT_SECURITY_POLICY,
  // The type we declare is the type the browser uses. Without this a browser may sniff a stored
  // vector file as a page.
  'x-content-type-options': 'nosniff',
}

/** The part of an Express response the image funnel needs. */
interface HeaderTarget {
  set: (name: string, value: string) => unknown
}

/** Set the image security headers on a response that is about to carry image bytes. */
export function setImageSecurityHeaders(res: HeaderTarget): void {
  for (const [name, value] of Object.entries(IMAGE_SECURITY_HEADERS)) res.set(name, value)
}
