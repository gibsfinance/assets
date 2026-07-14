import networks from '../networks.json'

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
  'bip122-0': 'Bitcoin', 'bip122-2': 'Litecoin', 'bip122-3': 'Dogecoin',
  'bip122-5': 'Dash', 'bip122-121': 'Horizen', 'bip122-133': 'Zcash',
  'bip122-145': 'Bitcoin Cash', 'bip122-175': 'Ravencoin',
  'monero-128': 'Monero', 'solana-501': 'Solana', 'cardano-1815': 'Cardano',
  'memo-144': 'XRP', 'memo-148': 'Stellar', 'tvm-195': 'Tron',
  'cosmos-118': 'Cosmos', 'ton-607': 'TON', 'aptos-637': 'Aptos', 'sui-784': 'Sui',
  'near-397': 'NEAR', 'polkadot-354': 'Polkadot', 'algorand-283': 'Algorand', 'fil-461': 'Filecoin',
}

export function getNetworkName(chainId: string | number): string {
  const key = String(chainId)
  if (NON_EVM_NAMES[key]) return NON_EVM_NAMES[key]
  // Strip any namespace prefix (eip155-369 -> 369) before the numeric lookup.
  const id = Number(key.includes('-') ? key.split('-').pop() : key)
  if (priorityNames[id]) return priorityNames[id]
  const entry = (networks as Record<string, string>)[String(id)]
  if (entry) return entry
  return `Chain ${id}`
}
