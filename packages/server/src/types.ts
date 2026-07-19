import type { Bridge, BridgeLink, Image, Network, Token } from './db/schema-types'
import type { ImageMode } from './db/tables'
import type { Hex } from 'viem'
import { MinimalTokenInfo } from '@gibs/utils'

export type Todo = (signal: AbortSignal) => Promise<void>

export type ImageModeParam = ImageMode | 'default'

export type PerNetworkBridgeLink = {
  tokenAddress: Hex
  originationBridgeAddress: Hex
  destinationBridgeAddress: Hex
}
export type Extensions = {
  headerUri?: string
  bridgeInfo?: Record<number, PerNetworkBridgeLink>
}

export type SansMetadataTokenEntry = {
  /**
   * Numeric chain reference, as the token-list format requires. Ambiguous on its
   * own — Solana is 501 and so is any eip155 chain numbered 501 — so read a served
   * entry's `chainIdentifier` when the namespace matters.
   */
  chainId: number
  address: Hex
  logoURI?: string
  extensions?: Extensions
  sources?: string[]
}

export type TokenEntry = SansMetadataTokenEntry & {
  name: string
  symbol: string
  decimals: number
}

export type TokenEntryMetadataOptional = SansMetadataTokenEntry | TokenEntry

/**
 * A token entry as this API *serves* it: the token-list shape plus the full CAIP-2
 * identifier the token is stored under (`eip155-369`, `solana-501`).
 *
 * Distinct from TokenEntry because the two directions differ. Ingested entries —
 * upstream token-list JSON, on-chain reads in the pulsex collector — follow the
 * standard schema, which has only a numeric `chainId`; the identifier is ours to
 * add on the way out, never theirs to supply. Requiring it on TokenEntry would
 * demand that every upstream list invent a field the format does not define.
 *
 * Carried per token because the envelope minimalList builds for `/list/merged` and
 * provider lists names no chain at all, so without this the namespace is
 * unrecoverable from those responses. Mirrors the `chainId`/`chainIdentifier` pair
 * `/stats` and `/list/tokens` already publish at the envelope level.
 */
export type ServedTokenEntry = TokenEntryMetadataOptional & { chainIdentifier: string }

export type InternetMoneyNetwork = {
  txnType: number
  graceBlocks: number
  wNativeAddress: Hex
  networkName: string
  chainId: number
  sym: string
  explore: string
  testnet: number
  rpc: string
  icon: string
  tokens: MinimalTokenInfo[]
}

export type TokenListVersion = {
  major: number
  minor: number
  patch: number
}
export type TokenMap = Record<`${number}_${Hex}`, TokenEntry>
export type TokenList = {
  logoURI?: string
  name: string
  timestamp: string
  version: TokenListVersion
  tokens: TokenEntry[]
}

export type BridgeLinkInfo = {
  bridge: Bridge
  bridgeLink: BridgeLink
  networkA: Network
  networkB: Network
  nativeToken: Token
  bridgedToken: Token
}

export type HeaderUriInfo = {
  headerImageHash: string
  headerListTokenId: string
}

export type TokenSourceInfo = {
  providerKey: string
  listKey: string
}

export type TokenInfo = Network & Token & Image & BridgeLinkInfo & HeaderUriInfo & TokenSourceInfo
