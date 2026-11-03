/**
 * @module useChainTokens
 * The merged token list for one chain, in the shape the Studio works in.
 *
 * Owns the `/list/tokens/:chainIdentifier` requests so every consumer shares one
 * cache entry and one mapping. The Studio page needs the same list the browser
 * shows — it resolves `?token=<address>` against it — and two call sites building
 * `Token` objects from the raw response would be two chances to disagree about
 * which chain a token belongs to.
 */
import { useEffect, useMemo } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { getApiUrl } from '../utils'
import { toChainIdentifier } from '../utils/chain-identifier'
import { preloadFirstScreenIcons } from '../utils/token-icon'
import {
  COMPACT_TOKEN_QUERY,
  assertCompactTokens,
  decodeCompactTokens,
  type CompactTokensResponse,
} from '../utils/compact-tokens'
import type { Token } from '../types'

/**
 * How many tokens the first-screen request asks for.
 *
 * A screen of 44 px rows fills about 20 rows on a tall display. 60 adds
 * overscan above and below, so the list looks complete until the full chain
 * arrives, while the response stays a few kilobytes instead of six megabytes.
 */
export const FIRST_SCREEN_TOKEN_COUNT = 60

const FIVE_MINUTES = 5 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000

/**
 * The one place a `/list/tokens` request path is built, so the slice and the
 * full list always ask for the same compact body.
 */
function chainTokensPath(identifier: string, options: { limit?: number } = {}): string {
  const limit = options.limit === undefined ? '' : `limit=${options.limit}&`
  return `/list/tokens/${identifier}?${limit}${COMPACT_TOKEN_QUERY}`
}

/**
 * Fetch one compact `/list/tokens` response.
 *
 * A non-2xx status throws, and so does a body that is not a compact list. The
 * check runs here so the failure reaches the query, not a component's render.
 */
async function fetchChainTokens(path: string): Promise<CompactTokensResponse> {
  const response = await fetch(getApiUrl(path))
  if (!response.ok) throw new Error(`${response.status}`)
  const body = (await response.json()) as CompactTokensResponse
  assertCompactTokens(body)
  return body
}

/**
 * Query options for a chain's complete token list.
 *
 * Exported so a caller that warms the cache (the prefetch on hover) uses the
 * identical key and settings as the hook that later reads it.
 *
 * @param identifier - Namespaced chain identifier; null disables the query.
 */
export function fullChainTokensQueryOptions(identifier: string | null) {
  return queryOptions({
    queryKey: ['tokensByChain', identifier],
    // `enabled` guarantees an identifier is resolved when this runs.
    queryFn: () => fetchChainTokens(chainTokensPath(identifier!)),
    enabled: !!identifier,
    staleTime: FIVE_MINUTES,
    gcTime: ONE_HOUR,
  })
}

/**
 * Query options for the first screen of a chain's tokens.
 *
 * Its key is separate from the full list's, so the slice never occupies the
 * full list's cache entry. The response still carries the server's full total.
 *
 * @param identifier - Namespaced chain identifier; null disables the query.
 */
export function firstScreenChainTokensQueryOptions(identifier: string | null) {
  return queryOptions({
    queryKey: ['tokensByChainFirstScreen', identifier],
    queryFn: () => fetchChainTokens(chainTokensPath(identifier!, { limit: FIRST_SCREEN_TOKEN_COUNT })),
    enabled: !!identifier,
    staleTime: FIVE_MINUTES,
    gcTime: ONE_HOUR,
  })
}

/**
 * Shape a response into the `Token`s the Studio works in.
 *
 * Every token in the response belongs to the chain that was requested, so each
 * is stamped with the identifier it was fetched under. The response carries
 * only the bare number, and rebuilding an identifier from that assumes
 * Ethereum-Virtual-Machine — which asked for Solana's tokens under eip155-501
 * and got a 400 for every icon.
 */
export function shapeTokens(response: CompactTokensResponse, identifier: string): Token[] {
  return decodeCompactTokens(response).map((token) => {
    const listReferences = token.sources.map((sourceList) => ({
      sourceList,
      imageUri: getApiUrl(`/image/${identifier}/${token.address}`),
      imageFormat: '',
    }))
    return {
      chainId: response.chainId,
      chainIdentifier: identifier,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      // `logoURI` is not requested because every row has one: the endpoint drops
      // tokens without a logo (see `buildTokensByChainResponse` in
      // packages/server/src/server/list/handlers.ts).
      hasIcon: true,
      sourceList: token.sources[0] ?? 'merged',
      listReferences: listReferences.length > 0 ? listReferences : undefined,
    }
  })
}

/**
 * Fetch and shape the tokens on a chain, first screen first.
 *
 * Two requests run in parallel. The slice answers fast, so rows appear while
 * the full list is still downloading and parsing. Once the full list arrives
 * it replaces the slice; the slice is the first rows of the same ordering, so
 * the visible rows do not reorder.
 *
 * @param chainId - Bare id or namespaced identifier; null while no chain is chosen.
 * @returns The chain's tokens (the full list once loaded, else the slice), the
 *   server's total (null until either loads), and whether neither has loaded.
 */
export function useChainTokens(chainId: string | null): {
  tokens: Token[]
  total: number | null
  isLoading: boolean
} {
  // Keyed on the resolved identifier, not the caller's spelling: "1" and
  // "eip155-1" name one chain and must not occupy two cache entries.
  const identifier = chainId ? toChainIdentifier(chainId) : null

  const full = useQuery(fullChainTokensQueryOptions(identifier))
  const slice = useQuery(firstScreenChainTokensQueryOptions(identifier))

  // The slice is the earliest list the rows can use, so its icons start now
  // rather than when each row renders. Reading it here, not in the query
  // function, keeps a hover prefetch from starting icons for rows only passed.
  const sliceData = slice.data
  useEffect(() => {
    if (!sliceData || !identifier) return
    preloadFirstScreenIcons(identifier, shapeTokens(sliceData, identifier))
  }, [sliceData, identifier])

  const response = full.data ?? slice.data
  const tokens = useMemo(() => {
    if (!response || !identifier) return []
    return shapeTokens(response, identifier)
  }, [response, identifier])

  return {
    tokens,
    total: response?.total ?? null,
    isLoading: full.isLoading && slice.isLoading,
  }
}
