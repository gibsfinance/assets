import type { NetworkInfo } from '../types'

/**
 * Chains gib.show serves any asset for: has tokens OR a logo, excluding testnets.
 *
 * Reads the flags useMetrics resolved rather than deriving its own, so this count and
 * the drawer's testnet toggle can never disagree about what a chain is. See
 * is-testnet.ts for how that classification is made.
 */
export const countSupportedNetworks = (networks: NetworkInfo[]): number =>
  networks.filter((n) => (n.tokenCount > 0 || n.hasImage) && !n.isTestnet).length

/**
 * How well a network answers a search term. Higher wins; 0 means no match.
 *
 * Mirrors the token search tiers for the same reason: with over 1,900 networks,
 * typing "eth" should surface Ethereum, not the first alphabetical chain whose
 * name happens to contain those letters.
 */
export const NETWORK_RELEVANCE = {
  identifierExact: 5,
  chainIdExact: 4,
  namePrefix: 3,
  nameContains: 2,
  identifierContains: 1,
  none: 0,
} as const

/**
 * Score one network against an already-lowercased search term.
 *
 * @param network - The network to score.
 * @param term - Lowercased, trimmed search term; must not be empty.
 * @returns A `NETWORK_RELEVANCE` value — 0 when nothing matches.
 */
export function scoreNetworkMatch(network: NetworkInfo, term: string): number {
  const name = network.name.toLowerCase()
  const identifier = network.chainIdentifier.toLowerCase()

  if (identifier === term) return NETWORK_RELEVANCE.identifierExact
  if (String(network.chainId) === term) return NETWORK_RELEVANCE.chainIdExact
  if (name.startsWith(term)) return NETWORK_RELEVANCE.namePrefix
  if (name.includes(term)) return NETWORK_RELEVANCE.nameContains
  if (identifier.includes(term)) return NETWORK_RELEVANCE.identifierContains
  return NETWORK_RELEVANCE.none
}

/**
 * Match networks against a search term, most relevant first.
 *
 * Ties keep their incoming order, which is the drawer's curated ordering
 * (Ethereum, PulseChain, then alphabetical). `Array.prototype.sort` has been
 * specified as stable since ES2019, which is what preserves it.
 *
 * @param networks - Candidates, already in the order the drawer wants them.
 * @param searchTerm - Raw user input; empty returns the input untouched.
 * @returns Matching networks ordered by relevance.
 */
export function searchNetworks(networks: NetworkInfo[], searchTerm: string): NetworkInfo[] {
  const term = searchTerm.trim().toLowerCase()
  if (!term) return networks
  return networks
    .map((network) => ({ network, score: scoreNetworkMatch(network, term) }))
    .filter((scored) => scored.score > NETWORK_RELEVANCE.none)
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.network)
}
