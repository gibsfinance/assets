/**
 * @module useChainTokens
 * The merged token list for one chain, in the shape the Studio works in.
 *
 * Owns the `/list/tokens/:chainIdentifier` request so every consumer shares one
 * cache entry and one mapping. The Studio page needs the same list the browser
 * shows — it resolves `?token=<address>` against it — and two call sites building
 * `Token` objects from the raw response would be two chances to disagree about
 * which chain a token belongs to.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getApiUrl } from '../utils'
import { toChainIdentifier } from '../utils/chain-identifier'
import type { Token } from '../types'

/** One entry as the server returns it, before it becomes a `Token`. */
interface ApiToken {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  sources?: string[]
}

interface ChainTokensResponse {
  chainId: number
  total: number
  tokens: ApiToken[]
}

/**
 * Fetch and shape every token on a chain.
 *
 * @param chainId - Bare id or namespaced identifier; null while no chain is chosen.
 * @returns The chain's tokens, the server's total (null until loaded), and load state.
 */
export function useChainTokens(chainId: string | null): {
  tokens: Token[]
  total: number | null
  isLoading: boolean
} {
  // Keyed on the resolved identifier, not the caller's spelling: "1" and
  // "eip155-1" name one chain and must not occupy two cache entries.
  const identifier = chainId ? toChainIdentifier(chainId) : null

  const { data, isLoading } = useQuery({
    queryKey: ['tokensByChain', identifier],
    queryFn: async () => {
      // `enabled` below guarantees an identifier is resolved here.
      const response = await fetch(getApiUrl(`/list/tokens/${identifier!}`))
      if (!response.ok) throw new Error(`${response.status}`)
      return response.json() as Promise<ChainTokensResponse>
    },
    enabled: !!identifier,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })

  const tokens = useMemo(() => {
    if (!data?.tokens || !identifier) return []
    // Every token in the response belongs to the chain that was requested, so
    // stamp each with the identifier it was fetched under. The response carries
    // only the bare number, and rebuilding an identifier from that assumes
    // Ethereum-Virtual-Machine — which asked for Solana's tokens under
    // eip155-501 and got a 400 for every icon.
    return data.tokens.map((token) => {
      const sources = token.sources ?? []
      const listReferences = sources.map((sourceList) => ({
        sourceList,
        imageUri: getApiUrl(`/image/${identifier}/${token.address}`),
        imageFormat: '',
      }))
      return {
        chainId: token.chainId,
        chainIdentifier: identifier,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        hasIcon: !!token.logoURI,
        sourceList: sources[0] ?? 'merged',
        listReferences: listReferences.length > 0 ? listReferences : undefined,
      }
    })
  }, [data, identifier])

  return { tokens, total: data?.total ?? null, isLoading }
}
