/**
 * Pure parsing helpers for the Jupiter Solana collector, kept free of database,
 * filesystem, and terminal-renderer imports so they can be unit-tested in isolation
 * (mirrors ethereum-lists-parse.ts).
 *
 * The source is Jupiter's Token API V2 (`lite-api.jup.ag/tokens/v2/tag?query=verified`),
 * which returns a bare array of token objects. Each object names the mint in `id`
 * (not `address`), the logo in `icon` (not `logoURI`), and carries a `tags` array
 * used to split the verified universe into one list per meaningful tag. Every token
 * is filed under the CAIP-2 id `solana-501`.
 */

/**
 * The CAIP-2 identifier every ingested Jupiter token is stored under. gib.show keys
 * non-Ethereum-Virtual-Machine networks by their coin-type id, so Solana lives at
 * `solana-501` (type `solana`), never at a bare `eip155` number.
 */
export const SOLANA_CHAIN_IDENTIFIER = 'solana-501'
export const SOLANA_NETWORK_TYPE = 'solana'

/**
 * The tags the verified universe is split along, in display order. Only these are
 * turned into lists; Jupiter's noisier operational tags (moonshot-verified,
 * community-assist, birdeye-trending, duplicate, internal, and so on) are ignored.
 * A tag that ends up with no tokens is simply skipped by the collector.
 */
export const MEANINGFUL_TAGS: readonly string[] = [
  'verified',
  'strict',
  'community',
  'lst',
  'stable',
  'defi',
  'meme',
  'rwa',
  'stocks',
  'xstocks',
  'ondo',
  'launchpad',
  'token-2022',
  'yield',
  'infra',
  'major',
]

/** A validated Jupiter token ready for insertion under solana-501. */
export type JupiterToken = {
  /** Base58 mint address, kept verbatim — base58 is case-significant and must not be lowercased. */
  readonly address: string
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly logoURI: string
  /** The tags this token carries, narrowed to strings; drives the per-tag list split. */
  readonly tags: readonly string[]
}

/**
 * Narrow an unknown value to a non-empty, non-whitespace string. Used at the
 * external-input boundary because API responses may carry blank or non-string
 * values in fields the schema marks as mandatory.
 */
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * The base58 alphabet excludes 0, O, I and l. Solana mint addresses are 32–44
 * characters within this alphabet; anything outside that window is rejected so a
 * malformed or hex-shaped id never reaches the base58-only serving path.
 */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** Narrow an unknown `tags` field to an array of non-empty strings. */
const resolveTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? tags.filter((tag): tag is string => isNonEmptyString(tag)) : []

/**
 * Parse one Jupiter token object into a token entry, or return null to skip it.
 *
 * A token is skipped when: its `id` is missing or not a plausible base58 mint;
 * `symbol` or `name` is missing or empty; or `decimals` is not a finite number.
 * `decimals: 0` is a legitimate value and is accepted. The logo (`icon`) and tags
 * are optional and default to an empty string and an empty array respectively.
 *
 * The object arrives as `unknown` because API responses are external input; every
 * field is narrowed before use rather than trusted.
 * @param raw A single token object from the Jupiter Token API.
 */
export const parseJupiterToken = (raw: unknown): JupiterToken | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  const address = record.id
  if (!isNonEmptyString(address) || !BASE58_ADDRESS.test(address)) {
    return null
  }
  const { name, symbol, decimals, icon } = record
  if (!isNonEmptyString(name) || !isNonEmptyString(symbol)) {
    return null
  }
  if (typeof decimals !== 'number' || !Number.isFinite(decimals)) {
    return null
  }
  return {
    address,
    name,
    symbol,
    decimals,
    logoURI: isNonEmptyString(icon) ? icon : '',
    tags: resolveTags(record.tags),
  }
}
