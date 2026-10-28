/**
 * @module usePrefetchChainTokens
 * Start a chain's token requests when the pointer or keyboard shows intent.
 *
 * A click used to be the first sign of interest, so the download began after
 * it. A pointer usually rests on a control for a few hundred milliseconds
 * before the click lands, and that time is enough to finish the first-screen
 * request. The prefetch uses the same query options as `useChainTokens`, so the
 * click finds the cache already warm.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toChainIdentifier } from '../utils/chain-identifier'
import { firstScreenChainTokensQueryOptions, fullChainTokensQueryOptions } from './useChainTokens'

/** The event props that signal intent on a control. Spread them onto the element. */
export interface ChainIntentHandlers {
  onPointerEnter: () => void
  onPointerDown: () => void
  onFocus: () => void
}

/**
 * Build intent handlers that warm the token cache for a chain.
 *
 * React Query de-duplicates requests in flight and skips data that is still
 * fresh, so repeated hovers cost nothing after the first. A failed prefetch is
 * silent; the click then makes its own request and reports the failure.
 *
 * @returns A function from a chain (bare id or namespaced identifier) to the
 *   handlers to spread onto that chain's control.
 */
export function usePrefetchChainTokens(): (chainId: string | number) => ChainIntentHandlers {
  const queryClient = useQueryClient()

  return useCallback(
    (chainId) => {
      const identifier = toChainIdentifier(chainId)
      const prefetch = () => {
        void queryClient.prefetchQuery(firstScreenChainTokensQueryOptions(identifier))
        void queryClient.prefetchQuery(fullChainTokensQueryOptions(identifier))
      }
      return { onPointerEnter: prefetch, onPointerDown: prefetch, onFocus: prefetch }
    },
    [queryClient],
  )
}
