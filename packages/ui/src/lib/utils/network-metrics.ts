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
