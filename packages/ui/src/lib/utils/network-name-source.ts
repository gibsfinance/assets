/**
 * Pure transforms behind `yarn gen:networks`, which regenerates networks.json — the
 * chain-id -> display-name map getNetworkName() consults before falling back to
 * "Chain <id>". Kept apart from the script that performs the fetch and the write so
 * tests can exercise the logic without a network call or a file rewrite, matching how
 * the server splits chainlist-parse.ts out of its collector.
 */

type RegistryEntry = { chainId?: unknown; name?: unknown }

/**
 * Reduces the ethereum-lists registry payload to a chain-id -> name map, keeping only
 * entries with a positive-integer id and a non-empty name.
 * @param raw Parsed chains.json payload
 * @return Map of stringified chain id to display name
 */
export const toNameMap = (raw: unknown): Record<string, string> => {
  if (!Array.isArray(raw)) throw new Error('chains.json did not parse to an array')
  const map: Record<string, string> = {}
  for (const entry of raw as RegistryEntry[]) {
    const { chainId, name } = entry ?? {}
    if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) continue
    if (typeof name !== 'string' || !name.trim()) continue
    map[String(chainId)] = name.trim()
  }
  return map
}

/**
 * Folds a freshly fetched registry map into the committed one.
 *
 * Upstream wins on every id it still publishes — a rename there is a correction worth
 * taking (Cronos Mainnet Beta -> Cronos Mainnet). Ids upstream has dropped keep their
 * existing name rather than being deleted: the registry removing a chain says nothing
 * about whether a collector still files tokens under it, and a missing name renders as
 * "Chain <id>" while a stale one is merely dated. Keys are ordered numerically so the
 * committed diff stays readable.
 * @param existing Currently committed map
 * @param upstream Map derived from a fresh registry fetch
 * @return Merged map ordered by numeric chain id
 */
export const mergeNameMaps = (
  existing: Record<string, string>,
  upstream: Record<string, string>,
): Record<string, string> => {
  const merged = { ...existing, ...upstream }
  return Object.fromEntries(
    Object.keys(merged)
      .sort((a, b) => Number(a) - Number(b))
      .map((id) => [id, merged[id]]),
  )
}
