/**
 * @module token-search
 * Shared token filtering, sorting, and API response inspection utilities.
 *
 * Used by TokenSearch, StudioBrowser, and EndpointCard. Extracted to eliminate
 * duplicated filter/sort logic across components and enable isolated testing.
 */
import type { NetworkInfo, Token } from '../types'

/** Filter tokens by search term matching name, symbol, or address (case-insensitive) */
export function filterTokensBySearch(tokens: Token[], searchTerm: string): Token[] {
  const term = searchTerm.toLowerCase()
  if (!term) return tokens
  return tokens.filter(
    (t) =>
      t.name.toLowerCase().includes(term) ||
      t.symbol.toLowerCase().includes(term) ||
      t.address.toLowerCase().includes(term),
  )
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
