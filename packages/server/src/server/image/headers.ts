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
