import { useState, useCallback } from 'react'
import { createPublicClient, http, erc20Abi } from 'viem'
import * as viemChains from 'viem/chains'
import type { LocalToken } from './useLocalLists'
import type { Chain } from 'viem'

const RPC_STORAGE_KEY = 'gib-custom-rpcs'

function getCustomRpcs(): Record<number, string> {
  try {
    const raw = localStorage.getItem(RPC_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function setCustomRpc(chainId: number, rpcUrl: string): void {
  const rpcs = getCustomRpcs()
  rpcs[chainId] = rpcUrl
  localStorage.setItem(RPC_STORAGE_KEY, JSON.stringify(rpcs))
}

export function getChainById(chainId: number) {
  const match = Object.values(viemChains).find(
    (c) => typeof c === 'object' && c !== null && 'id' in c && (c as Chain).id === chainId,
  )
  return match as Chain | undefined
}

export function getClient(chainId: number) {
  const customRpcs = getCustomRpcs()
  const customRpc = customRpcs[chainId]
  const chain = getChainById(chainId)

  if (customRpc) {
    return createPublicClient({
      chain: chain || {
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [customRpc] } },
      },
      transport: http(customRpc),
    })
  }

  if (!chain) return null

  return createPublicClient({
    chain,
    transport: http(),
  })
}

export interface MetadataResult {
  address: string
  name: string | null
  symbol: string | null
  decimals: number | null
  error?: string
}

interface ReadContractClient {
  readContract(args: { address: `0x${string}`; abi: typeof erc20Abi; functionName: string }): Promise<unknown>
}

/** Fetch ERC-20 metadata for a single token. Exported for direct testing. */
export async function fetchTokenMetadata(
  client: ReadContractClient,
  address: string,
): Promise<MetadataResult> {
  try {
    const [name, symbol, decimals] = await Promise.all([
      client
        .readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: 'name' })
        .catch(() => null),
      client
        .readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: 'symbol' })
        .catch(() => null),
      client
        .readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: 'decimals' })
        .catch(() => null),
    ])
    return {
      address,
      name: name as string | null,
      symbol: symbol as string | null,
      decimals: decimals !== null ? Number(decimals) : null,
    }
  } catch (err) {
    return { address, name: null, symbol: null, decimals: null, error: (err as Error).message }
  }
}

export function useRpcMetadata() {
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const loadMetadata = useCallback(
    async (tokens: LocalToken[], chainId: number): Promise<MetadataResult[]> => {
      const client = getClient(chainId)
      if (!client) {
        return tokens.map((t) => ({
          address: t.address,
          name: null,
          symbol: null,
          decimals: null,
          error: 'No RPC available',
        }))
      }

      setIsLoading(true)
      setProgress({ done: 0, total: tokens.length })
      const results: MetadataResult[] = []

      const batchSize = 10
      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize)
        const batchResults = await Promise.all(
          batch.map((token) => fetchTokenMetadata(client, token.address)),
        )
        results.push(...batchResults)
        setProgress({ done: Math.min(i + batchSize, tokens.length), total: tokens.length })
      }

      setIsLoading(false)
      return results
    },
    [],
  )

  return { loadMetadata, isLoading, progress }
}
