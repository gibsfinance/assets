/**
 * @module useTokenSearch
 * The cross-chain token search behind the browser's search box.
 *
 * One debounced request to `/list/search`, which is why the endpoint exists. The
 * interface used to answer a query by downloading every provider list — 1,193
 * requests and hundreds of megabytes — and filtering them in the browser. The
 * server now ranks and truncates the same search in a single round trip.
 *
 * Results deliberately span chains: someone typing a symbol the selected chain
 * has never heard of is asking where that token lives, and narrowing the search
 * to the chain already on screen would make it a slower copy of the local
 * filter. Each hit therefore carries its own namespaced identifier, which is
 * what addresses its image.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import _ from 'lodash'
import { getApiUrl } from '../utils'
import { tokenChainIdentifier } from '../utils/chain-identifier'
import type { SearchUpdate, Token } from '../types'

/** One search hit as the server returns it, before it becomes a `Token`. */
interface ApiSearchToken {
  chainId: number
  /** Namespace the token was listed under. Absent only from a malformed response. */
  chainIdentifier?: string
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  sources?: string[]
}

interface SearchResponse {
  query: string
  /** Present only when the search was scoped to one chain, which this hook never does. */
  chainIdentifier?: string
  /** More tokens matched than were returned. There is no total: the query stops at a cap. */
  truncated: boolean
  tokens: ApiSearchToken[]
}

/**
 * Shortest term the endpoint accepts. Anything shorter is a 400, so it must not
 * leave the browser — a rejected request is a wasted round trip that also reads
 * as a failed search to everything downstream of it.
 */
export const MINIMUM_SEARCH_LENGTH = 2

/** How long typing has to pause before the search is issued. */
export const SEARCH_DEBOUNCE_MILLISECONDS = 500

/** The state a search publishes when it has nothing to show. */
const emptyUpdate = (query: string, overrides: Partial<SearchUpdate> = {}): SearchUpdate => ({
  query,
  tokens: [],
  truncated: false,
  isSearching: false,
  isError: false,
  ...overrides,
})

/**
 * Shape one hit into the `Token` the browser renders, matching `useChainTokens`.
 *
 * Reads the identifier the server sent rather than rebuilding one from the bare
 * `chainId`. Results span chains here, so the selected chain says nothing about
 * where a given hit lives, and a bare number names no namespace — 501 is
 * Solana's and Columbus testnet's alike. Deriving it asked
 * `/image/eip155-501/<base58 address>` and got a 400 for every Solana icon.
 */
const toToken = (entry: ApiSearchToken): Token => {
  const identifier = tokenChainIdentifier(entry)
  const sources = entry.sources ?? []
  const listReferences = sources.map((sourceList) => ({
    sourceList,
    imageUri: getApiUrl(`/image/${identifier}/${entry.address}`),
    imageFormat: '',
  }))
  return {
    chainId: entry.chainId,
    chainIdentifier: identifier,
    address: entry.address,
    name: entry.name,
    symbol: entry.symbol,
    decimals: entry.decimals,
    hasIcon: !!entry.logoURI,
    sourceList: sources[0] ?? 'merged',
    listReferences: listReferences.length > 0 ? listReferences : undefined,
  }
}

/** Whether a rejection is this hook superseding its own request. */
const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError'

interface UseTokenSearchOptions {
  /** Called on every keystroke and again whenever the search's state changes. */
  onUpdate: (update: SearchUpdate) => void
}

interface UseTokenSearchResult {
  /** True while a request is in flight, for the spinner beside the box. */
  isSearching: boolean
  /** Report what was typed. Echoes it immediately and schedules the request. */
  search: (raw: string) => void
}

/**
 * Search every chain's tokens for a term, debounced.
 *
 * @param options.onUpdate - Receives the echoed keystroke, then the outcome.
 * @returns Whether a request is in flight, and the function to report typing to.
 */
export function useTokenSearch({ onUpdate }: UseTokenSearchOptions): UseTokenSearchResult {
  const [isSearching, setIsSearching] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Read through a ref so a caller that rebuilds this callback every render cannot
  // rebuild anything below it. See the debounce comment: a wrapper that changes
  // identity loses its pending invocation to the unmount cleanup.
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const runSearch = useCallback(async (query: string) => {
    // A search in flight is answering a term the user has already moved past.
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setIsSearching(true)
    onUpdateRef.current(emptyUpdate(query, { isSearching: true }))

    try {
      const response = await fetch(getApiUrl(`/list/search?q=${encodeURIComponent(query)}`), {
        signal: abortController.signal,
      })
      if (!response.ok) throw new Error(`${response.status}`)
      const body = (await response.json()) as SearchResponse
      onUpdateRef.current({
        query,
        tokens: (body.tokens ?? []).map(toToken),
        truncated: !!body.truncated,
        isSearching: false,
        isError: false,
      })
    } catch (error) {
      // A superseded search publishes nothing at all. Emitting its empty result would
      // wipe out what its successor is in the middle of fetching, so the user watches
      // matches appear and then vanish for no visible reason.
      if (isAbort(error)) return
      onUpdateRef.current(emptyUpdate(query, { isError: true }))
    } finally {
      // Only the search that is still the current one may lower the flag. An aborted
      // predecessor clearing its successor's spinner left a dead spinner over a box
      // that was, at the time, gated on exactly that flag — and so frozen for good.
      if (abortControllerRef.current === abortController) setIsSearching(false)
    }
  }, [])

  // One identity for the life of the hook, which is the point. The implementation this
  // wraps used to close over the query, so it was rebuilt on every keystroke, which
  // rebuilt the wrapper — and the unmount cleanup below then cancelled the pending
  // invocation belonging to the previous wrapper. Every keystroke scheduled a search and
  // immediately cancelled it, so the global search never ran once. The query is an
  // argument now and the caller's callback is read through a ref, so nothing a caller
  // does can rebuild this.
  const debouncedSearch = useMemo(() => _.debounce(runSearch, SEARCH_DEBOUNCE_MILLISECONDS), [runSearch])

  const search = useCallback(
    (raw: string) => {
      const query = raw.trim()
      // Echo the keystroke before any network work so the already-loaded chain list can
      // be narrowed locally while the request is out, and so a previous search's results
      // are not left standing under a query that no longer produced them.
      onUpdateRef.current(emptyUpdate(raw))

      if (query.length < MINIMUM_SEARCH_LENGTH) {
        // Too short for the endpoint is also too short to be waiting on. Abandoning the
        // request in flight is what makes clearing the box stick: otherwise the previous
        // term's results land a moment later on top of the empty state.
        debouncedSearch.cancel()
        abortControllerRef.current?.abort()
        abortControllerRef.current = null
        setIsSearching(false)
        return
      }
      debouncedSearch(query)
    },
    [debouncedSearch],
  )

  useEffect(
    () => () => {
      debouncedSearch.cancel()
      abortControllerRef.current?.abort()
    },
    [debouncedSearch],
  )

  return { isSearching, search }
}
