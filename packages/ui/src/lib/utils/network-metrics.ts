import type { NetworkInfo } from '../types'
import { getNetworkName } from './network-name'

/** Chains gib.show serves any asset for: has tokens OR a logo, excluding testnets. */
export const countSupportedNetworks = (networks: NetworkInfo[]): number =>
  networks.filter(
    (n) => (n.tokenCount > 0 || n.hasImage) && !getNetworkName(n.chainIdentifier).toLowerCase().includes('testnet'),
  ).length
