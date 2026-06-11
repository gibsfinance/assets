/**
 * @module chain-identifier
 * CAIP-2 chain identifier helpers for the UI, mirroring the server's
 * packages/server/src/chain-id.ts. Dash instead of colon for URL safety:
 * eip155-369 (not eip155:369).
 *
 * The server accepts both bare numeric ids and prefixed identifiers in every
 * endpoint; the UI prefers emitting the prefixed form so URLs, copyable
 * examples, and generated snippets all carry the unambiguous identifier.
 */

const ASSET_CHAIN = '0'
const ASSET_PREFIX = 'asset'
const EVM_PREFIX = 'eip155'

/**
 * Convert a bare numeric chain id (or an already-prefixed identifier) to the
 * canonical prefixed form: 369 → eip155-369, 0 → asset-0, eip155-1 → eip155-1.
 */
export function toChainIdentifier(chainId: string | number): string {
  const input = String(chainId)
  if (input.includes('-')) return input
  if (input === ASSET_CHAIN) return `${ASSET_PREFIX}-${ASSET_CHAIN}`
  return `${EVM_PREFIX}-${input}`
}

/**
 * Extract the bare reference from a prefixed identifier: eip155-369 → 369.
 * Bare numerics pass through unchanged so callers can accept either form.
 */
export function fromChainIdentifier(input: string): string {
  const dashIndex = input.indexOf('-')
  if (dashIndex === -1) return input
  return input.slice(dashIndex + 1)
}
