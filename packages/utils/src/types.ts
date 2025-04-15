import type { Abi, Hex } from 'viem'

export type Todo = () => Promise<void>

export type Call = {
  allowFailure?: boolean
  functionName: string
  target?: Hex
  abi?: Abi
  args?: any[]
}

export type ChainId = number | bigint | Hex

export type TokenChainInfo = [string, string, number]

export type MinimalTokenInfo = {
  address: string
  name: string
  symbol: string
  decimals: number
}
export type MinimalTokenInfoWithLogo = MinimalTokenInfo & {
  logoURI?: string | null
}
