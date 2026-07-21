/**
 * Pure parsing helpers for the ethereum-lists collector, kept free of database,
 * filesystem, and terminal-renderer imports so they can be unit-tested without
 * loading the collector runtime (mirrors chainlist-parse.ts).
 *
 * The source is the ethereum-lists/tokens repository, vendored as a git submodule.
 * Each token lives in its own file at `tokens/<slug>/<checksummed-address>.json`.
 */
import type { Hex } from 'viem'
import type { TokenEntry } from '../types'

/**
 * Authoritative folder-slug to numeric chain-id map, transcribed from the source
 * repository's `Main.kt` `networkMapping`. Only these folders are ingested; any
 * folder absent from this map is treated as unknown and left alone.
 *
 * Several of these chains (Ethereum Social esn=2, Ubiq ubq=8, Ellaism ella=64,
 * Vinci vc=207) may be unknown to gib.show's chain registry, so network creation
 * for their folders can fail — the collector tolerates that per folder rather than
 * aborting the whole run.
 */
export const NETWORK_MAPPING: Record<string, number> = {
  eth: 1,
  esn: 2,
  ubq: 8,
  rsk: 30,
  bsc: 56,
  etc: 61,
  ella: 64,
  sonic: 146,
  vc: 207,
  zks: 324,
  arb: 42161,
  avax: 43114,
}

/**
 * Folder slugs for testnets whose chains no longer exist (Ropsten, Rinkeby,
 * Goerli, Kovan). Their token files are still present on disk in the submodule,
 * but ingesting them would create dead networks, so they are excluded explicitly.
 */
export const DEAD_TESTNET_SLUGS: ReadonlySet<string> = new Set(['rop', 'rin', 'gor', 'kov'])

/**
 * The outcome of resolving a folder slug to a chain id:
 *   - `included`  — the folder is in the authoritative map and carries its chain id
 *   - `excluded`  — the folder is a known dead testnet and must be skipped
 *   - `unknown`   — the folder is neither mapped nor a recognised dead testnet
 */
export type ChainIdResolution =
  | { readonly status: 'included'; readonly chainId: number }
  | { readonly status: 'excluded' }
  | { readonly status: 'unknown' }

/**
 * Resolve a folder slug to its chain id, distinguishing the deliberately excluded
 * dead testnets from folders the map simply does not cover. Keeping the two apart
 * lets the collector stay silent about dead testnets while still surfacing a
 * genuinely unrecognised folder for review.
 * @param slug The folder name under `tokens/` (for example `eth` or `rop`).
 */
export const resolveChainId = (slug: string): ChainIdResolution => {
  const chainId = NETWORK_MAPPING[slug]
  if (typeof chainId === 'number') {
    return { status: 'included', chainId }
  }
  if (DEAD_TESTNET_SLUGS.has(slug)) {
    return { status: 'excluded' }
  }
  return { status: 'unknown' }
}

/**
 * Narrow an unknown value to a non-empty, non-whitespace string. Used at the
 * external-input boundary because token files are community-maintained and may
 * carry blank or non-string values in fields the schema marks as mandatory.
 */
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * Resolve a token's optional logo to a usable url, or an empty string when absent.
 *
 * The upstream schema documents `logo` as a plain string, but in practice most
 * files carry an object `{ src, width, height, ipfs_hash }`. Both shapes are
 * accepted: an object contributes its `src`, a non-empty string contributes
 * itself, and anything else yields an empty string so the token still ingests
 * with no logo rather than being dropped.
 * @param logo The raw `logo` field from a token file, of unknown shape.
 */
export const resolveLogo = (logo: unknown): string => {
  if (isNonEmptyString(logo)) {
    return logo
  }
  if (logo && typeof logo === 'object' && 'src' in logo) {
    const { src } = logo as { src: unknown }
    return isNonEmptyString(src) ? src : ''
  }
  return ''
}

/**
 * A token is rejected outright when it carries a non-empty `redFlags` array. That
 * field marks scam or otherwise suspicious contracts in the source repository, and
 * such entries must never be ingested regardless of how complete their metadata is.
 */
const hasRedFlags = (value: unknown): boolean => Array.isArray(value) && value.length > 0

/**
 * Parse one token file record into a token-list entry, or return null to skip it.
 *
 * A token is skipped when: it carries a non-empty `redFlags` array (flagged scam
 * or suspicious); `symbol`, `name`, or `address` is missing or empty; or `decimals`
 * is not a finite number. `decimals: 0` is a legitimate value and is accepted — the
 * source stores decimals as a number, never a string, so a string here is rejected.
 *
 * The record arrives as `unknown` because token files are external input; every
 * field is narrowed before use rather than trusted.
 * @param raw The parsed JSON contents of a single token file.
 * @param chainId The numeric chain id resolved from the token's folder slug.
 */
export const parseTokenRecord = (raw: unknown, chainId: number): TokenEntry | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  if (hasRedFlags(record.redFlags)) {
    return null
  }
  const { symbol, name, address, decimals } = record
  if (!isNonEmptyString(symbol) || !isNonEmptyString(name) || !isNonEmptyString(address)) {
    return null
  }
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) {
    return null
  }
  return {
    chainId,
    address: address as Hex,
    name,
    symbol,
    decimals,
    logoURI: resolveLogo(record.logo),
  }
}
