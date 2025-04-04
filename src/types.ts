import { Bridge, BridgeLink, Image, Network, Token } from 'knex/types/tables'
import * as viem from 'viem'
import type { ImageMode } from '@/db/tables'

export type Todo = () => Promise<void>

export type ImageModeParam = ImageMode | 'default'

export type PerNetworkBridgeLink = {
  tokenAddress: viem.Hex
  originationBridgeAddress: viem.Hex
  destinationBridgeAddress: viem.Hex
}
export type Extensions = {
  bridgeInfo?: Record<number, PerNetworkBridgeLink>
}

export type SansMetadataTokenEntry = {
  chainId: number
  address: viem.Hex
  logoURI?: string
  extensions?: Extensions
}

export type TokenEntry = SansMetadataTokenEntry & {
  name: string
  symbol: string
  decimals: number
}

export type TokenEntryMetadataOptional = SansMetadataTokenEntry | TokenEntry

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

export type TokenInfo = Network &
  Token &
  Image & {
    bridge: Bridge
    bridgeLink: BridgeLink
    networkA: Network
    networkB: Network
    nativeToken: Token
    bridgedToken: Token
  }
