export interface TokenInfo {
  chainId: number
  address: string
  name: string
  symbol: string
}

export interface NetworkInfo {
  chainId: number
  name: string
  isActive: boolean
}

export interface PlatformMetrics {
  tokenList: {
    total: number
    byChain: Record<string, number>
    topListByChain: Record<string, string>
  }
  networks: {
    supported: NetworkInfo[]
    active: string
  }
}
