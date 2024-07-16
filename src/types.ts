import { Image, Network, Token } from 'knex/types/tables'
import * as viem from 'viem'

export type Todo = () => Promise<void>

export type TokenEntry = {
  chainId: number
  address: viem.Hex
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  extensions?: {
    bridgeInfo?: Record<number, PerNetworkBridgeLink>
  }
}

export type InternetMoneyToken = {
  address: string
  icon: string
  symbol: string
  decimals: number
}

export type InternetMoneyNetwork = {
  txnType: number
  graceBlocks: number
  wNativeAddress: viem.Hex
  networkName: string
  chainId: number
  sym: string
  explore: string
  testnet: number
  rpc: string
  icon: string
  tokens: InternetMoneyToken[]
}

export type TokenListVersion = {
  major: number
  minor: number
  patch: number
}
export type TokenMap = Record<`${number}_${viem.Hex}`, TokenEntry>
export type PerNetworkBridgeLink = {
  tokenAddress: viem.Hex;
  originationBridgeAddress: viem.Hex;
  destinationBridgeAddress: viem.Hex;
}
export type TokenList = {
  logoURI?: string
  name: string
  timestamp: string
  version: TokenListVersion
  tokens: TokenEntry[]
}

export type Call = {
  allowFailure?: boolean
  functionName: string
  target?: viem.Hex
  abi?: viem.Abi
  args?: any[]
}

export type ChainId = number | bigint | viem.Hex

export type TokenInfo = Network & Token & Image
