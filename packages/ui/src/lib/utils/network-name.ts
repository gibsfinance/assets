import { useEffect, useSyncExternalStore } from 'react'

/** Chain id -> display name, as vendored in networks.json. */
export type NetworkNameTable = Record<string, string>

const priorityNames: Record<number, string> = {
  1: 'Ethereum',
  369: 'PulseChain',
  56: 'BNB Smart Chain',
  137: 'Polygon',
  42161: 'Arbitrum One',
  10: 'Optimism',
  100: 'Gnosis Chain',
  324: 'zkSync Era',
  534352: 'Scroll',
  146: 'Sonic',
  250: 'Fantom Opera',
  1030: 'Conflux eSpace',
  5000: 'Mantle',
  8453: 'Base',
  43114: 'Avalanche C-Chain',
  59144: 'Linea',
  7777777: 'Zora',
  943: 'PulseChain Testnet v4',
  245022934: 'Neon EVM MainNet',
  728126428: 'Tron Mainnet',
}

/** Curated display names for the non-Ethereum-Virtual-Machine chains gib.show serves. */
const NON_EVM_NAMES: Record<string, string> = {
  'bip122-0': 'Bitcoin',
  'bip122-2': 'Litecoin',
  'bip122-3': 'Dogecoin',
  'bip122-5': 'Dash',
  'bip122-121': 'Horizen',
  'bip122-133': 'Zcash',
  'bip122-145': 'Bitcoin Cash',
  'bip122-175': 'Ravencoin',
  'monero-128': 'Monero',
  'solana-501': 'Solana',
  'cardano-1815': 'Cardano',
  'memo-144': 'XRP',
  'memo-148': 'Stellar',
  'tvm-195': 'Tron',
  'cosmos-118': 'Cosmos',
  'ton-607': 'TON',
  'aptos-637': 'Aptos',
  'sui-784': 'Sui',
  'near-397': 'NEAR',
  'polkadot-354': 'Polkadot',
  'algorand-283': 'Algorand',
  'fil-461': 'Filecoin',
}

let nameTable: NetworkNameTable | null = null
let pendingLoad: Promise<NetworkNameTable | null> | null = null
const listeners = new Set<() => void>()

/**
 * Start loading the vendored chain-name table, once. The table is 84 kB raw, so it is a
 * separate chunk rather than part of the entry bundle every visitor downloads. Repeat
 * calls share one promise. A failed fetch resolves to null and clears the cache so a
 * later call can retry; names fall back to "Chain <id>" meanwhile.
 */
export function loadNetworkNameTable(): Promise<NetworkNameTable | null> {
  if (nameTable) return Promise.resolve(nameTable)
  if (pendingLoad) return pendingLoad
  pendingLoad = import('../networks.json')
    .then((module) => {
      nameTable = module.default as NetworkNameTable
      listeners.forEach((notify) => notify())
      return nameTable
    })
    .catch(() => {
      pendingLoad = null
      return null
    })
  return pendingLoad
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readNameTable(): NetworkNameTable | null {
  return nameTable
}

/**
 * Start the table load after the component mounts (off the first-paint path) and
 * re-render exactly once when it lands. Returns the table, or null until then.
 * Use it only where a name can depend on the table: a caller that always passes a
 * non-empty `registryName`, or a curated id, never needs it.
 */
export function useNetworkNameTable(): NetworkNameTable | null {
  useEffect(() => {
    void loadNetworkNameTable()
  }, [])
  // The third argument is what a render with no browser sees (the build-time render of the
  // home page): the table has not loaded, exactly as on a first client render.
  return useSyncExternalStore(subscribe, readNameTable, () => null)
}

/**
 * Resolve a chain's display name, best source first:
 *
 *  1. NON_EVM_NAMES / priorityNames — names this repo curates on purpose. The registry
 *     calls chain 1 "Ethereum Mainnet" and chain 10 "OP Mainnet"; the drawer says
 *     "Ethereum" and "Optimism". Curation outranks upstream, including `registryName`.
 *  2. registryName — the name the server stored alongside the chain's icon. Always
 *     current, because it is written by the same collection run that adds the network.
 *  3. networks.json — the vendored registry snapshot, refreshed by `yarn gen:networks`.
 *     Loaded on demand; until it lands this tier is skipped.
 *     Covers chains no collector named (a network known only to a token list) and any
 *     caller without a server response to hand in.
 *  4. "Chain <id>" — recognisable, and better than a blank label.
 *
 * @param chainId Bare id or namespaced identifier (369, "369", "eip155-369", "bip122-0").
 * @param options.registryName Name from the server's /networks payload, when available.
 */
export function getNetworkName(chainId: string | number, options: { registryName?: string | null } = {}): string {
  const key = String(chainId)
  if (NON_EVM_NAMES[key]) return NON_EVM_NAMES[key]
  // Strip any namespace prefix (eip155-369 -> 369) before the numeric lookup.
  const id = Number(key.includes('-') ? key.split('-').pop() : key)
  if (priorityNames[id]) return priorityNames[id]
  const registryName = options.registryName?.trim()
  if (registryName) return registryName
  const entry = nameTable?.[String(id)]
  if (entry) return entry
  return `Chain ${id}`
}
