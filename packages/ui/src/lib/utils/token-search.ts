import type { Token } from '../types'

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
    const aIsMainnet = a.chainId.toString() === '1'
    const bIsMainnet = b.chainId.toString() === '1'
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
 * Derive popular chains from network metrics.
 * Filters out testnets and chains with fewer than `minTokens`, sorts by token count.
 */
export function getPopularChains(
  supportedNetworks: { chainId: number }[],
  tokensByChain: Record<number, number>,
  getChainName: (chainId: number) => string,
  { limit = 8, minTokens = 10 } = {},
): { chainId: string; name: string; tokenCount: number }[] {
  return supportedNetworks
    .map((n) => ({
      chainId: String(n.chainId),
      name: getChainName(n.chainId),
      tokenCount: tokensByChain[n.chainId] || 0,
    }))
    .filter((n) => n.tokenCount >= minTokens)
    .filter((n) => !n.name.toLowerCase().includes('testnet'))
    .sort((a, b) => b.tokenCount - a.tokenCount)
    .slice(0, limit)
}
