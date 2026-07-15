import type { NetworkInfo } from '../types'

/**
 * Chains gib.show serves any asset for: has tokens OR a logo, excluding testnets.
 *
 * Reads the `name` useMetrics resolved rather than deriving its own, so the count and
 * the drawer label can never disagree about what a chain is called.
 *
 * Testnet detection is a name substring, which undercounts: the registry publishes no
 * testnet flag, and plenty of testnets are not named like one ("Goerli", "Ethereum
 * Sepolia", "Amoy"). Those are counted as mainnet here.
 */
export const countSupportedNetworks = (networks: NetworkInfo[]): number =>
  networks.filter((n) => (n.tokenCount > 0 || n.hasImage) && !n.name.toLowerCase().includes('testnet')).length
