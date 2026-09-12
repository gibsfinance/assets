/**
 * @module aggregator-parse
 * Reading tokens out of a bridge aggregator's own catalogue.
 *
 * An aggregator is not a token list. It publishes whatever it is willing to
 * route, which is a much larger and much dirtier set than a curated list: LiFi
 * carries 17,495 tokens across 71 chains and marks 3,579 of them flagged, and
 * Relay will answer with entries like "Infinite Monkey: POAYFPKWSKCHB" beside
 * Tether. Serving artwork for those is not a neutral act. A convincing logo on
 * a token an aggregator has flagged is help a scam does not otherwise get.
 *
 * So nothing here is permissive. Every field is read from an unknown value, a
 * token that cannot be read is refused rather than repaired, and only tokens
 * the source itself vouches for are returned.
 */

/** One token, after it has been read and checked. */
export interface AggregatorToken {
  /** Ethereum Virtual Machine chain id. */
  chainId: number
  /** Contract address, as the source gave it. The caller normalizes. */
  address: string
  name: string
  symbol: string
  decimals: number
  /** Where the artwork lives, or null when the source has none. */
  logoURI: string | null
}

/** Why tokens were refused, and how many for each reason. */
export type RejectionCounts = Record<string, number>

export interface ParsedCatalogue {
  tokens: AggregatorToken[]
  rejected: RejectionCounts
}

/**
 * Largest decimals count a token can declare.
 *
 * The token standard holds decimals in an unsigned eight-bit field. The number
 * is an exponent, so a value outside the range is not a display quirk.
 */
export const MAX_DECIMALS = 255

/**
 * The reading primitives below are exported as a set, not one at a time for a
 * test's convenience. Each aggregator parser narrows its own response before
 * handing the pieces to `readToken`, and `asRecord` is already used by all three;
 * a fourth source reading a field `readToken` does not cover should reach for
 * these rather than write "is this really a number" again.
 */

/** A whole number of zero or more. Rejects negatives and fractions alike. */
export const isWholeAtLeastZero = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/**
 * Text with something in it, or null.
 *
 * `String(undefined)` is the six-character word "undefined", and a token whose
 * name reads "undefined" is worse than one with no name: it looks like data.
 */
export const presentText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * A whole number, whether it arrived as one or as digits in a string.
 *
 * `Number('')` and `Number(null)` are both 0, so only values that already carry
 * something are converted. A blank field is absent, not zero.
 */
export const wholeNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : null
  }
  return null
}

/** A record, or null. Arrays are not records here. */
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/**
 * Build the common token shape from fields already pulled out of a source's own
 * response, refusing anything that cannot be read.
 *
 * Every aggregator names these fields differently, so each source narrows its
 * own response and hands the pieces here. That keeps one set of rules about what
 * counts as readable, rather than one set per source.
 */
export const readToken = (fields: {
  chainId: unknown
  address: unknown
  name: unknown
  symbol: unknown
  decimals: unknown
  logoURI: unknown
}): AggregatorToken | { reason: string } => {
  const chainId = wholeNumber(fields.chainId)
  // Chain zero is not a chain, and a negative one is not either. The database
  // refuses a non-Ethereum chain echoed as a bare number, but a nonsense number
  // would reach it as a plausible new chain and create a network row for it.
  if (chainId === null || chainId < 1) return { reason: 'unreadable chain id' }

  const address = presentText(fields.address)
  if (!address) return { reason: 'no address' }

  const symbol = presentText(fields.symbol)
  if (!symbol) return { reason: 'no symbol' }

  const decimals = wholeNumber(fields.decimals)
  // Refused rather than defaulted. Substituting eighteen for a value we cannot
  // read turns a broken token into a plausible one, and the reader cannot tell.
  if (!isWholeAtLeastZero(decimals) || decimals > MAX_DECIMALS) {
    return { reason: 'decimals outside 0 to 255' }
  }

  return {
    chainId,
    address,
    // An aggregator that carries no name still carries a symbol, and a token
    // row needs something to be called. Falling back is stated here rather than
    // left for a reader to infer from a blank column.
    name: presentText(fields.name) ?? symbol,
    symbol,
    decimals,
    logoURI: presentText(fields.logoURI),
  }
}

/** Add one refusal to the tally. */
export const countRejection = (rejected: RejectionCounts, reason: string): void => {
  rejected[reason] = (rejected[reason] ?? 0) + 1
}

/**
 * Group tokens by the chain they are on, keeping each chain's order.
 *
 * One list per chain is how every other multi-chain collector here files its
 * tokens, and the list row carries a network id, so the grouping has to happen
 * before anything is written.
 */
export const groupByChain = (tokens: AggregatorToken[]): Map<number, AggregatorToken[]> => {
  const byChain = new Map<number, AggregatorToken[]>()
  for (const token of tokens) {
    const existing = byChain.get(token.chainId)
    if (existing) {
      existing.push(token)
      continue
    }
    byChain.set(token.chainId, [token])
  }
  return byChain
}

/**
 * Drop tokens repeated within one chain, keeping the first.
 *
 * An aggregator can list the same address twice - once per route it supports -
 * and the second insert would rewrite the first token's position in the list.
 */
export const dedupeByAddress = (tokens: AggregatorToken[]): AggregatorToken[] => {
  const seen = new Set<string>()
  const kept: AggregatorToken[] = []
  for (const token of tokens) {
    const identity = `${token.chainId}:${token.address.toLowerCase()}`
    if (seen.has(identity)) continue
    seen.add(identity)
    kept.push(token)
  }
  return kept
}
