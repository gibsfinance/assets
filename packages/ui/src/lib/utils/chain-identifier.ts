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
 * Resolve the chain identifier to address a token by.
 *
 * Prefers the namespace the token was listed under and only falls back to reading
 * the bare `chainId`, which cannot distinguish Solana's 501 from Columbus
 * testnet's. Every token image URL should go through this: deriving from the
 * number alone asked `/image/eip155-501/<base58 address>` for Solana's tokens,
 * which the server rejects as a malformed Ethereum-Virtual-Machine address.
 */
export function tokenChainIdentifier(token: { chainId: string | number; chainIdentifier?: string }): string {
  return token.chainIdentifier ?? toChainIdentifier(token.chainId)
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

/**
 * Rewrite an /image/… path so its chain segment carries the prefixed
 * identifier: /image/1/0xabc → /image/eip155-1/0xabc, /image/369 →
 * /image/eip155-369. Non-image paths pass through untouched.
 */
export function prefixImagePath(path: string): string {
  const match = path.match(/^\/image\/([^/]+)(\/.*)?$/)
  if (!match) return path
  const [, chain, rest] = match
  return `/image/${toChainIdentifier(chain)}${rest ?? ''}`
}
