export interface TokenListToken {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
}

export interface TokenList {
  name: string
  timestamp: string
  version: { major: number; minor: number; patch: number }
  tokens: TokenListToken[]
}

export interface NetworkInfo {
  networkId: string
  type: string
  chainId: string
  imageHash: string | null
}

export interface ListInfo {
  key: string
  name: string
  providerKey: string
  chainId: string
  chainType: string
  default: boolean
  major: number
  minor: number
  patch: number
}
