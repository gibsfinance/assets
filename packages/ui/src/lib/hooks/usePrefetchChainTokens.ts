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

/** A prefetch is a guess; the click makes its own request and reports any failure. */
const ignoreFailedPrefetch = () => {}

/** The event props that signal intent on a control. Spread them onto the element. */
export interface ChainIntentHandlers {
  onPointerEnter: () => void
  onPointerDown: () => void
  onFocus: () => void
}

/**
 * Build intent handlers that warm the token cache for a chain.
 *
 * Hover and focus fetch only the first screen. They fire for every control the
 * pointer crosses, and the network drawer has over 1,900 rows: fetching full
 * lists there would start a multi-megabyte download, and a main-thread parse,
 * for each chain the pointer passed on its way down. The first screen is a few
 * kilobytes, which is cheap to waste. Pressing the pointer is a commitment, so
 * that also starts the full list, about a hundred milliseconds before the click.
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
      const prefetchFirstScreen = () => {
        queryClient.query(firstScreenChainTokensQueryOptions(identifier)).catch(ignoreFailedPrefetch)
      }
      const prefetchEverything = () => {
        prefetchFirstScreen()
        queryClient.query(fullChainTokensQueryOptions(identifier)).catch(ignoreFailedPrefetch)
      }
      return { onPointerEnter: prefetchFirstScreen, onFocus: prefetchFirstScreen, onPointerDown: prefetchEverything }
    },
    [queryClient],
  )
}
