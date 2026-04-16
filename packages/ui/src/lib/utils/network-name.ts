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

export function getNetworkName(chainId: string | number): string {
  const id = Number(chainId)
  if (priorityNames[id]) return priorityNames[id]
  const entry = (networks as Record<string, string>)[String(id)]
  if (entry) return entry
  return `Chain ${id}`
}
