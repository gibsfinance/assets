/**
 * Pure parsing helpers for the chainlist collector, kept free of database and
 * fetch imports so they can be unit-tested without loading the collector runtime.
 */

/** An Ethereum-Virtual-Machine chain, as the two registries between them describe it. */
export type ChainlistEntry = {
  chainId: number
  /**
   * The icon identifier to fetch, or null when no icon may honestly be shown.
   *
   * Null is a real answer, not a missing one. An icon is a claim about which
   * chain a number is, exactly as a name is, so an icon taken from a registry
   * that disagrees about the chain would put one network's logo on another.
   */
  icon: string | null
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
 * Whether a value names a file in the icons directory.
 *
 * chainlist.org's `icon` is usually a bare slug, and sometimes is not: a handful
 * of entries carry a whole image address, and at least one carries the literal
 * text `[object Object]`, which is somebody's serialization escaping into the
 * feed. Either would be pasted into an icons path and fetched as a name.
 */
export const isIconIdentifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('/') &&
  !value.includes(':') &&
  value !== '[object Object]'

/**
 * Whether two registry names are talking about the same chain.
 *
 * Deliberately loose: "Ronin" and "Ronin Mainnet" are one chain, and holding out
 * for an exact match would throw away a good icon over a word. What it has to
 * separate is the real disagreements — chain 999 is "HyperEVM" to one registry
 * and "Wanchain Testnet" to the other, and those are not the same chain by any
 * reading.
 */
const MIN_PREFIX_MATCH = 3

export const namesSameChain = (a: string | undefined, b: string | undefined): boolean => {
  const normalize = (value: string | undefined) =>
    (value ?? '')
      .toLowerCase()
      .replace(/\b(mainnet|network|chain)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
  const left = normalize(a)
  const right = normalize(b)
  if (!left || !right) return false
  if (left === right) return true
  // One name extending the other is the same chain said at two lengths:
  // "XRPL EVM" against "XRPL EVM Sidechain". The shorter side has to be long
  // enough to mean something, or a name that normalizes down to a letter or two
  // — "W Chain" becomes "w" — would match every chain starting with it.
  const shorter = left.length <= right.length ? left : right
  const longer = shorter === left ? right : left
  return shorter.length >= MIN_PREFIX_MATCH && longer.startsWith(shorter)
}

/**
 * Combine the two network registries into one list.
 *
 * `authoritative` is chainlist.org, which is the current answer to "which chain
 * is this number". `fallback` is ethereum-lists/chains, which is where the icon
 * files actually live and which lags: it still lists chain 999 as Wanchain
 * Testnet, years after Wanchain's testnet stopped using it and after Hyperliquid
 * took it for HyperEVM. Both registries agree that 998 is Hyperliquid's testnet,
 * which is the corroboration that settles it.
 *
 * The name comes from the authority. The icon comes from whichever registry
 * agrees with the authority about what the chain is — so where they disagree,
 * the fallback's icon is dropped rather than shown against the other chain's
 * name. Nine chains lose an icon that way, and no chain wears another's logo.
 *
 * An entry survives if it has an icon to fetch or a name worth writing.
 */
export const mergeRegistries = (authoritative: unknown, fallback: unknown): ChainlistEntry[] => {
  const usable = (value: { chainId?: unknown }) =>
    typeof value?.chainId === 'number' && Number.isInteger(value.chainId) && value.chainId > 0

  const byId = <T extends { chainId?: unknown }>(raw: unknown): Map<number, T> => {
    const map = new Map<number, T>()
    if (!Array.isArray(raw)) return map
    for (const value of raw) {
      if (!value || !usable(value)) continue
      // First occurrence wins, as before: both registries carry duplicate rows.
      if (!map.has(value.chainId)) map.set(value.chainId, value as T)
    }
    return map
  }

  type RawChain = { chainId: number; icon?: unknown; name?: unknown; title?: unknown }
  const leading = byId<RawChain>(authoritative)
  const trailing = byId<RawChain>(fallback)

  const entries: ChainlistEntry[] = []
  for (const chainId of new Set([...leading.keys(), ...trailing.keys()])) {
    const lead = leading.get(chainId)
    const trail = trailing.get(chainId)
    const name = parseText(lead?.name) ?? parseText(trail?.name)
    const title = parseText(lead?.title) ?? parseText(trail?.title)

    const agree = lead && trail ? namesSameChain(parseText(lead.name), parseText(trail.name)) : !lead || !trail
    // The fallback's icon only counts when the two registries are describing the
    // same chain. Otherwise the authority's own icon stands, and if it has none
    // the chain goes without one.
    const agreedIcon = agree && isIconIdentifier(trail?.icon) ? trail.icon : undefined
    const authoritativeIcon = isIconIdentifier(lead?.icon) ? lead.icon : undefined
    const icon = agreedIcon ?? authoritativeIcon ?? null

    // An entry earns its place by having artwork to fetch, or by being one of the
    // chains the two registries describe differently — those need their name
    // rewritten precisely because the icon beside it was withheld. Every other
    // nameless-or-iconless chain is left alone: this collector exists to supply
    // network artwork, and creating a thousand rows for chains that have none
    // would be a different job done by accident.
    const correctsIdentity = Boolean(lead && trail && !agree)
    if (!icon && !correctsIdentity) continue
    entries.push({ chainId, icon, name, title })
  }
  return entries
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
