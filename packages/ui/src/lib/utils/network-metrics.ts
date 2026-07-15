import type { NetworkInfo } from '../types'
import { isTestnetName } from './is-testnet'

/**
 * Chains gib.show serves any asset for: has tokens OR a logo, excluding testnets.
 *
 * Reads the `name` useMetrics resolved rather than deriving its own, so the count and
 * the drawer label can never disagree about what a chain is called. See is-testnet.ts
 * for why the testnet test is a name match and not one of the registry's structured
 * fields.
 */
export const countSupportedNetworks = (networks: NetworkInfo[]): number =>
  networks.filter((n) => (n.tokenCount > 0 || n.hasImage) && !isTestnetName(n.name)).length
