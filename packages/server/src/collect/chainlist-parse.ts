/**
 * Pure parsing helpers for the chainlist collector, kept free of database and
 * fetch imports so they can be unit-tested without loading the collector runtime.
 */

/** An Ethereum-Virtual-Machine chain from chains.json that carries an icon key. */
export type ChainlistEntry = {
  chainId: number
  icon: string
}

/**
 * Keep only well-formed chains that carry an icon key, deduped by chainId.
 * chains.json is a large, community-maintained list, so junk and duplicate rows
 * are tolerated: anything without a positive integer chainId or a non-empty icon
 * string is dropped rather than trusted.
 */
export const parseChains = (raw: unknown): ChainlistEntry[] => {
  if (!Array.isArray(raw)) return []
  const byChainId = new Map<number, ChainlistEntry>()
  for (const value of raw) {
    if (
      value &&
      typeof value.chainId === 'number' &&
      Number.isInteger(value.chainId) &&
      value.chainId > 0 &&
      typeof value.icon === 'string' &&
      value.icon.length > 0 &&
      !byChainId.has(value.chainId)
    ) {
      byChainId.set(value.chainId, { chainId: value.chainId, icon: value.icon })
    }
  }
  return [...byChainId.values()]
}

/**
 * Extract the first image url from an ethereum-lists icon descriptor. The file is
 * a JSON array of `{ url, width, height, format }`; the url is an ipfs:// uri that
 * the image fetcher resolves through its configured gateways.
 */
export const pickIconUrl = (raw: unknown): string | null => {
  if (!Array.isArray(raw)) return null
  const first = raw[0] as { url?: unknown } | undefined
  return first && typeof first.url === 'string' && first.url.length > 0 ? first.url : null
}
