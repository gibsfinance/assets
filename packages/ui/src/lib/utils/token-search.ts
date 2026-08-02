/**
 * @module token-search
 * Shared token filtering, sorting, and API response inspection utilities.
 *
 * Extracted from the components that used to inline this so the ranking and
 * filtering rules can be tested on their own.
 */
import type { NetworkInfo, Token } from '../types'

/**
 * How well a token answers a search term. Higher wins; 0 means no match.
 *
 * The tiers exist because a plain substring filter is close to useless on a
 * large chain: "usdc" matches 160 tokens on Ethereum, and USD Coin itself came
 * back 52nd, behind fifty Curve and Yearn pools that merely mention it. An exact
 * symbol is almost always the token someone meant; a name that only contains the
 * term is the weakest evidence short of the address.
 */
export const SEARCH_RELEVANCE = {
  addressExact: 8,
  symbolExact: 7,
  symbolPrefix: 6,
  nameExact: 5,
  namePrefix: 4,
  symbolContains: 3,
  nameContains: 2,
  addressContains: 1,
  none: 0,
} as const

/**
 * Score one token against an already-lowercased search term.
 *
 * @param token - The token to score.
 * @param term - Lowercased, trimmed search term; must not be empty.
 * @returns A `SEARCH_RELEVANCE` value — 0 when nothing matches.
 */
export function scoreTokenMatch(token: Token, term: string): number {
  const symbol = token.symbol.toLowerCase()
  const name = token.name.toLowerCase()
  const address = token.address.toLowerCase()

  if (address === term) return SEARCH_RELEVANCE.addressExact
  if (symbol === term) return SEARCH_RELEVANCE.symbolExact
  if (symbol.startsWith(term)) return SEARCH_RELEVANCE.symbolPrefix
  if (name === term) return SEARCH_RELEVANCE.nameExact
  if (name.startsWith(term)) return SEARCH_RELEVANCE.namePrefix
  if (symbol.includes(term)) return SEARCH_RELEVANCE.symbolContains
  if (name.includes(term)) return SEARCH_RELEVANCE.nameContains
  if (address.includes(term)) return SEARCH_RELEVANCE.addressContains
  return SEARCH_RELEVANCE.none
}

/**
 * Match tokens against a search term, most relevant first.
 *
 * Ties keep their incoming order, which is the server's ranking (list ranking →
 * format → version) and so encodes which provider is trusted for that token.
 * `Array.prototype.sort` has been specified as stable since ES2019, which is
 * what preserves it — do not swap in a comparator that breaks ties itself.
 *
 * @param tokens - Candidates, already in the server's preferred order.
 * @param searchTerm - Raw user input; empty returns the input untouched.
 * @returns Matching tokens ordered by relevance.
 */
export function searchTokens(tokens: Token[], searchTerm: string): Token[] {
  const term = searchTerm.trim().toLowerCase()
  if (!term) return tokens
  return tokens
    .map((token) => ({ token, score: scoreTokenMatch(token, term) }))
    .filter((scored) => scored.score > SEARCH_RELEVANCE.none)
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.token)
}

/** Sort tokens: mainnet (chainId 1) first, then alphabetical by name */
export function sortTokensMainnetFirst(tokens: Token[]): Token[] {
  return [...tokens].sort((a, b) => {
    const aIsMainnet = String(a.chainId ?? '') === '1'
    const bIsMainnet = String(b.chainId ?? '') === '1'
    if (aIsMainnet && !bIsMainnet) return -1
    if (!aIsMainnet && bIsMainnet) return 1
    return a.name.localeCompare(b.name)
  })
}

/** Categorize lists by whether they're chain-specific or global (chainId=0) */
export function categorizeListsByScope<T extends { chainId: string }>(
  lists: T[],
): { global: T[]; chainSpecific: T[] } {
  return {
    global: lists.filter((l) => l.chainId === '0'),
    chainSpecific: lists.filter((l) => l.chainId !== '0'),
  }
}

/** Count results from an API response — checks .total, .tokens.length, or array length */
export function countResults(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if ('total' in obj && typeof obj.total === 'number') return obj.total
  if ('tokens' in obj && Array.isArray(obj.tokens)) return obj.tokens.length
  if (Array.isArray(data)) return data.length
  return null
}

/** Check if a fetch response was served from cache (CF or generic x-cache) */
export function isCacheHit(headers: Headers): boolean {
  const cacheHeader = headers.get('cf-cache-status') || headers.get('x-cache') || ''
  return /HIT/i.test(cacheHeader)
}

/** Parse URL path into segments, identifying {param} placeholders */
export function parsePathParams(path: string): Array<{ text: string; isParam: boolean }> {
  return path
    .split(/(\{[^}]+\})/)
    .filter(Boolean)
    .map((part) => ({
      text: part,
      isParam: /^\{[^}]+\}$/.test(part),
    }))
}

/**
 * Derive popular chains from network metrics: the busiest non-testnet chains,
 * each identified by the namespaced identifier callers should navigate to.
 *
 * Reads the `chainIdentifier`, `name`, `isTestnet`, and `tokenCount` useMetrics
 * already resolved rather than re-deriving them from the bare `chainId`, the same
 * correction sortNetworks carries. A bare number names no namespace and eleven of
 * them are claimed by two: keying on 501 gave Columbus testnet (eip155-501, zero
 * tokens) Solana's 9,633, listed both under the testnet's name, and pointed both
 * cards at the testnet — so Solana was unreachable from here and either card
 * landed on an empty browser.
 */
export function getPopularChains(
  supportedNetworks: NetworkInfo[],
  { limit = 8, minTokens = 10 } = {},
): { chainId: string; name: string; tokenCount: number }[] {
  return supportedNetworks
    .filter((n) => n.tokenCount >= minTokens && !n.isTestnet)
    .map((n) => ({
      chainId: n.chainIdentifier,
      name: n.name,
      tokenCount: n.tokenCount,
    }))
    .sort((a, b) => b.tokenCount - a.tokenCount)
    .slice(0, limit)
}
