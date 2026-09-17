/**
 * Pure parsing helpers for the web3icons collector, kept free of database and
 * fetch imports so they can be unit-tested without loading the collector runtime.
 *
 * The source is `0xa3k5/web3icons`'s network metadata file. Every one of its 250
 * entries declares a `branded` variant, so the only real filter is identity: an
 * entry only earns a place here when it carries a `caip2id` this project can
 * convert into its own chain identifier form without guessing.
 */

/** One row of the upstream `networks.json` metadata file, as loosely as it arrives. */
export type Web3IconsNetworkEntry = {
  id?: unknown
  caip2id?: unknown
  variants?: unknown
}

/** One entry worth collecting artwork for: our own chain identifier and the icon to fetch. */
export type Web3IconsCollectEntry = {
  /**
   * Our own chain identifier form — the entry's `caip2id` with its colon replaced
   * by a hyphen (`eip155:324` becomes `eip155-324`). This is a mechanical rewrite
   * of the namespace and reference the source already published, never a guess
   * built from a chain's name.
   */
  chainId: string
  /** The branded icon's address on the upstream repository. */
  iconUrl: string
}

/** Where the branded network icons live in the upstream repository, by entry id. */
const BRANDED_ICON_BASE_URL =
  'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/core/src/svgs/networks/branded'

/**
 * Whether a value is a usable CAIP-2 identifier: a non-empty string naming both a
 * namespace and a reference.
 *
 * 28 of the 250 entries ship no `caip2id` at all. Those entries cannot be matched
 * to a network safely — matching by name has already put one chain's identity on
 * another's number in this codebase (chain 999 is HyperEVM to one registry and
 * Wanchain Testnet to another) — so an entry without one is skipped here rather
 * than carried forward for the collector to guess at.
 */
export const hasUsableCaip2Id = (value: unknown): value is string => typeof value === 'string' && value.includes(':')

/**
 * Whether an entry's `variants` list includes the `branded` artwork this collector
 * fetches. Every entry in the current feed does, but the field is read rather than
 * assumed so a future entry shipping only `mono`/`background` is skipped instead of
 * fetching an address that does not exist.
 */
export const hasBrandedVariant = (variants: unknown): boolean => Array.isArray(variants) && variants.includes('branded')

/**
 * Convert a CAIP-2 identifier to this project's own chain identifier form.
 *
 * `caip2id` always carries exactly one colon separating its namespace from its
 * reference (the CAIP-2 reference character set excludes colons), so replacing it
 * is a complete, lossless rewrite for every namespace the source carries —
 * `eip155:324` becomes `eip155-324`, and `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`
 * becomes `solana-5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` rather than being coerced into
 * an Ethereum-style identifier.
 */
export const toGibsChainId = (caip2id: string): string => caip2id.replace(':', '-')

/** The branded icon address for a given upstream entry id. */
export const brandedIconUrl = (id: string): string => `${BRANDED_ICON_BASE_URL}/${encodeURIComponent(id)}.svg`

/**
 * Turn the raw metadata payload into the entries worth collecting: a usable chain
 * identifier paired with the branded icon address to fetch.
 *
 * This is identity-preserving and nothing more — it does not decide whether this
 * project already holds a network for the identifier, only whether the source
 * entry itself is usable. That existence check belongs to the collector, which
 * has the database to check against.
 */
export const parseNetworkEntries = (raw: unknown): Web3IconsCollectEntry[] => {
  if (!Array.isArray(raw)) return []
  const entries: Web3IconsCollectEntry[] = []
  for (const value of raw) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Web3IconsNetworkEntry
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    if (!hasUsableCaip2Id(entry.caip2id)) continue
    if (!hasBrandedVariant(entry.variants)) continue
    entries.push({ chainId: toGibsChainId(entry.caip2id), iconUrl: brandedIconUrl(entry.id) })
  }
  return entries
}
