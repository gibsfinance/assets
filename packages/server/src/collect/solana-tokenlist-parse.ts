/**
 * Pure parsing helpers for the Solana token-list collector, kept free of database,
 * filesystem, and terminal-renderer imports so they can be unit-tested in isolation
 * (mirrors ethereum-lists-parse.ts).
 *
 * The source is the solana-labs/token-list repository's assembled `solana.tokenlist.json`,
 * a standard token-list document whose `chainId` field carries a Solana cluster id
 * (101 mainnet-beta, 102 testnet, 103 devnet) rather than an Ethereum chain id. Only
 * mainnet tokens are ingested; every one is filed under the CAIP-2 id `solana-501`.
 */

/** Solana mainnet-beta cluster id, as it appears in the source list's `chainId` field. */
export const SOLANA_MAINNET_CLUSTER = 101

/**
 * The CAIP-2 identifier every ingested Solana token is stored under. gib.show keys
 * non-Ethereum-Virtual-Machine networks by their coin-type id, so Solana lives at
 * `solana-501` (type `solana`), never at a bare `eip155` number.
 */
export const SOLANA_CHAIN_IDENTIFIER = 'solana-501'
export const SOLANA_NETWORK_TYPE = 'solana'

/** A validated mainnet Solana token ready for insertion. */
export type SolanaTokenEntry = {
  /** Base58 mint address, kept verbatim — base58 is case-significant and must not be lowercased. */
  readonly address: string
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly logoURI: string
}

/**
 * Narrow an unknown value to a non-empty, non-whitespace string. Used at the
 * external-input boundary because token files are community-maintained and may
 * carry blank or non-string values in fields the schema marks as mandatory.
 */
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * The base58 alphabet excludes 0, O, I and l. Solana mint addresses are 32–44
 * characters within this alphabet; anything outside that window is rejected so a
 * malformed or hex-shaped address never reaches the base58-only serving path.
 */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/**
 * Resolve a token's optional logo to a usable url, or an empty string when absent.
 * Accepts only a plain non-empty string (the solana-labs schema stores `logoURI`
 * as a string); anything else yields an empty string so the token still ingests
 * with no logo rather than being dropped.
 * @param logo The raw `logoURI` field from a token record, of unknown shape.
 */
export const resolveLogo = (logo: unknown): string => (isNonEmptyString(logo) ? logo : '')

/**
 * Parse one token record into a Solana token entry, or return null to skip it.
 *
 * A token is skipped when: its `chainId` is not the mainnet-beta cluster (testnet
 * and devnet tokens are excluded); `symbol`, `name`, or `address` is missing or
 * empty; the address is not a plausible base58 mint; or `decimals` is not a finite
 * number. `decimals: 0` is a legitimate value and is accepted.
 *
 * The record arrives as `unknown` because list entries are external input; every
 * field is narrowed before use rather than trusted.
 * @param raw A single token entry from the assembled list.
 */
export const parseSolanaTokenRecord = (raw: unknown): SolanaTokenEntry | null => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  if (record.chainId !== SOLANA_MAINNET_CLUSTER) {
    return null
  }
  const { symbol, name, address, decimals } = record
  if (!isNonEmptyString(symbol) || !isNonEmptyString(name) || !isNonEmptyString(address)) {
    return null
  }
  if (!BASE58_ADDRESS.test(address)) {
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
    logoURI: resolveLogo(record.logoURI),
  }
}
