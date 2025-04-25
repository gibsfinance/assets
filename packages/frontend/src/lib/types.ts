export interface TokenInfo {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
}

export interface Token extends TokenInfo {
  hasIcon: boolean
  sourceList: string
  isBridgeToken?: boolean
  chainName?: string
}

export type ApiType = 'token' | 'network' | 'list'

export type PositionType = 'back' | 'middle' | 'front'

export type Hex = `0x${string}`

export type FloatingToken = {
  type?: ApiType
  chainId?: number
  address?: Hex
  size: number
  speed: number
  delay: number
  direction: number
  layer: PositionType
  startPos: number
}

export interface NetworkInfo {
  chainId: number
  name: string
  isActive: boolean
}

export interface PlatformMetrics {
  tokenList: {
    total: number
    byChain: Record<number, number>
  }
  networks: {
    supported: NetworkInfo[]
    active: string
  }
}

export type SearchUpdate = {
  query: string
  isSearching: boolean
  isGlobalSearching: boolean
  isError: boolean
  tokens: Token[]
}

export type ListDescription = {
  key: string
  name: string
  description: string
  default: boolean
  providerKey: string
  chainId: string
  chainType: string
}

export type Network = { type: string; chainId: string; networkId: string }

export interface CodeBlockProps {
  code?: string
  lang?: 'console' | 'html' | 'css' | 'js'
  theme?: 'dark-plus'
  // Base Style Props
  base?: string
  rounded?: string
  shadow?: string
  classes?: string
  // Pre Style Props
  preBase?: string
  prePadding?: string
  preClasses?: string
}
