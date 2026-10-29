import { useState, useCallback } from 'react'
import type { LocalToken } from './useLocalLists'
import type { Chain, PublicClient } from 'viem'

const RPC_STORAGE_KEY = 'gib-custom-rpcs'

/**
 * Load the viem library on demand.
 *
 * viem and its dependencies weigh about 800 kB minified, and only the token
 * metadata read needs them. A dynamic import keeps them out of the Studio chunk.
 * The browser fetches them the first time someone asks to read a chain.
 */
const loadViem = () => import('viem')

/**
 * Load every chain definition viem ships, on demand.
 *
 * Kept apart from `loadViem` because the chain table is large and is searched
 * only when a client is built.
 */
const loadViemChains = () => import('viem/chains')

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

/**
 * Find viem's definition of a chain by numeric identifier.
 *
 * @param chainId - The chain's numeric identifier.
 * @returns The chain definition, or undefined when viem does not know the chain.
 */
export async function getChainById(chainId: number): Promise<Chain | undefined> {
  const viemChains = await loadViemChains()
  const match = Object.values(viemChains).find(
    (c) => typeof c === 'object' && c !== null && 'id' in c && (c as Chain).id === chainId,
  )
  return match as Chain | undefined
}

/**
 * Build a read-only client for a chain, preferring the custom RPC the user saved.
 *
 * @param chainId - The chain's numeric identifier.
 * @returns A client, or null when viem does not know the chain and no custom RPC is saved.
 */
export async function getClient(chainId: number): Promise<PublicClient | null> {
  const customRpcs = getCustomRpcs()
  const customRpc = customRpcs[chainId]
  const [{ createPublicClient, http }, chain] = await Promise.all([loadViem(), getChainById(chainId)])

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

/** Fetch ERC-20 metadata for a single token. Exported for direct testing. */
export async function fetchTokenMetadata(
  client: { readContract(args: Record<string, unknown>): Promise<unknown> },
  address: string,
): Promise<MetadataResult> {
  try {
    const { erc20Abi } = await loadViem()
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address: address as `0x${string}`, abi: erc20Abi, functionName: 'name' }).catch(() => null),
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

  const loadMetadata = useCallback(async (tokens: LocalToken[], chainId: number): Promise<MetadataResult[]> => {
    const client = await getClient(chainId)
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
      const batchResults = await Promise.all(batch.map((token) => fetchTokenMetadata(client, token.address)))
      results.push(...batchResults)
      setProgress({ done: Math.min(i + batchSize, tokens.length), total: tokens.length })
    }

    setIsLoading(false)
    return results
  }, [])

  return { loadMetadata, isLoading, progress }
}
