/**
 * Pure parsing helpers for the chainlist collector, kept free of database and
 * fetch imports so they can be unit-tested without loading the collector runtime.
 */

/** An Ethereum-Virtual-Machine chain from chains.json that carries an icon key. */
export type ChainlistEntry = {
  chainId: number
  icon: string
  /** Registry display name, absent when the entry ships without a usable one. */
  name?: string
  /**
   * The registry's longer prose label ("Ethereum Testnet Sepolia"), on the ~11% of
   * chains that ship one. Carried because it is where a testnet named after a codename
   * ("Adiri", "Rinia") states what it actually is — see the UI's is-testnet.ts.
   */
  title?: string
}

/**
 * Pull a usable string off a chains.json entry, or undefined.
 *
 * The registry really does ship nameless chains (704851 has a null name), and a
 * blank string is worse than nothing downstream: a stored empty name would read as
 * "upstream named this" and suppress the fallback that would otherwise render a
 * recognisable "Chain <id>".
 */
const parseText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Keep only well-formed chains that carry an icon key, deduped by chainId.
 * chains.json is a large, community-maintained list, so junk and duplicate rows
 * are tolerated: anything without a positive integer chainId or a non-empty icon
 * string is dropped rather than trusted. A missing name is not disqualifying — the
 * icon is what this collector exists to fetch, and the name rides along with it.
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
      byChainId.set(value.chainId, {
        chainId: value.chainId,
        icon: value.icon,
        name: parseText(value.name),
        title: parseText(value.title),
      })
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
