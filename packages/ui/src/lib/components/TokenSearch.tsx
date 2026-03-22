import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import _ from 'lodash'
import { getApiUrl } from '../utils'
import { useMetricsContext } from '../contexts/MetricsContext'
import { limitConcurrency } from '../utils/concurrency'
import type { ListDescription, SearchUpdate, Token } from '../types'
import TokenListFilter from './TokenListFilter'

interface TokenSearchProps {
  onSearchUpdate: (state: SearchUpdate) => void
  count: number
  networkName: string
  selectedChain: number | null
  enabledLists: Set<string>
  tokensByList: Map<string, Token[]>
  onToggleList: (listId: string, enabled: boolean) => void
  onToggleAll: (enabled: boolean) => void
}

export default function TokenSearch({
  onSearchUpdate,
  count,
  networkName,
  selectedChain,
  enabledLists,
  tokensByList,
  onToggleList,
  onToggleAll,
}: TokenSearchProps) {
  const [query, setQuery] = useState('')
  const [_isSearching, setIsSearching] = useState(false)
  const [isGlobalSearching, setIsGlobalSearching] = useState(false)
  const searchAbortControllerRef = useRef<AbortController | null>(null)
  const { metrics, providers: contextProviders, fetchProviders } = useMetricsContext()



  const performGlobalSearch = useCallback(async () => {
    // Cancel any previous ongoing search
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort()
    }
    const abortController = new AbortController()
    searchAbortControllerRef.current = abortController

    setIsGlobalSearching(true)
    setIsSearching(true)
    onSearchUpdate({
      query,
      isSearching: true,
      isGlobalSearching: true,
      tokens: [],
      isError: false,
    })

    const searchTerm = query.toLowerCase()
    let globalSearchResults: Token[] = []

    const sortAndEmit = (results: Token[]) => {
      const tokens = _.uniqBy(results, (t) => `${t.chainId}-${t.address.toLowerCase()}`)
      tokens.sort((a, b) => {
        if (a.chainId.toString() === '1' && b.chainId.toString() !== '1') return -1
        if (a.chainId.toString() !== '1' && b.chainId.toString() === '1') return 1
        return a.name.localeCompare(b.name)
      })
      onSearchUpdate({
        query,
        isSearching: true,
        isGlobalSearching: true,
        tokens,
        isError: false,
      })
    }

    try {
      const lists = contextProviders.length ? contextProviders : await fetchProviders()
      if (!lists.length) {
        onSearchUpdate({
          query,
          isSearching: false,
          isGlobalSearching: false,
          tokens: [],
          isError: true,
        })
        return
      }
      const availableLists = lists.filter((list) => list.chainType === 'evm')
      const globalLists = availableLists.filter((list) => list.chainId === '0')
      const chainSpecificLists = availableLists.filter((list) => list.chainId !== '0')

      // Fetch global lists sequentially
      for (const list of globalLists) {
        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          // fetch global list
          const listResponse = await fetch(url, {
            signal: abortController.signal,
          })

          if (listResponse.ok) {
            const data = await listResponse.json()
            if (data?.tokens && Array.isArray(data.tokens)) {
              const matchingTokens = data.tokens
                .filter(
                  (token: Token) =>
                    token.name.toLowerCase().includes(searchTerm) ||
                    token.symbol.toLowerCase().includes(searchTerm) ||
                    token.address.toLowerCase().includes(searchTerm),
                )
                .map((token: Token) => ({
                  ...token,
                  hasIcon: true,
                  sourceList: `${list.providerKey}/${list.key}`,
                  isBridgeToken: list.providerKey.includes('bridge'),
                  chainName:
                    metrics?.networks.supported.find(
                      (n) => n.chainId.toString() === token.chainId.toString(),
                    )?.name || `Chain ${token.chainId}`,
                }))

              if (matchingTokens.length > 0) {
                globalSearchResults = [...globalSearchResults, ...matchingTokens]
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            // search aborted
            return
          }
          console.error(
            `Error searching global list ${list.providerKey}/${list.key}:`,
            error,
          )
        }
        onSearchUpdate({
          query,
          isSearching: true,
          isGlobalSearching: true,
          tokens: globalSearchResults,
          isError: false,
        })
      }

      // Fetch chain-specific lists with concurrency limit of 4
      await limitConcurrency(chainSpecificLists, 4, async (list: ListDescription) => {
        if (!searchAbortControllerRef.current) return

        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          // fetch chain-specific list
          const listResponse = await fetch(url, {
            signal: abortController.signal,
          })

          if (!listResponse.ok) return

          const data = (await listResponse.json()) as { tokens: Token[] }
          const tokens = data?.tokens && Array.isArray(data.tokens) && data.tokens
          if (!tokens) return

          const matchingTokens = tokens
            .filter(
              (token) =>
                token.name.toLowerCase().includes(searchTerm) ||
                token.symbol.toLowerCase().includes(searchTerm) ||
                token.address.toLowerCase().includes(searchTerm),
            )
            .map((token) => ({
              ...token,
              hasIcon: true,
              sourceList: `${list.providerKey}/${list.key}`,
              isBridgeToken: list.providerKey.includes('bridge'),
              chainName:
                metrics?.networks.supported.find(
                  (n) => n.chainId.toString() === token.chainId.toString(),
                )?.name || `Chain ${token.chainId}`,
            }))

          if (matchingTokens.length > 0) {
            globalSearchResults = [...globalSearchResults, ...matchingTokens]
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            // search aborted
            return
          }
          if (error instanceof Error && !error.message.includes('404')) {
            console.error(
              `Error searching chain-specific list ${list.providerKey}/${list.key}:`,
              error,
            )
            return
          }
        }
        sortAndEmit(globalSearchResults)
      })
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Global search error:', error)
      }
    } finally {
      setIsSearching(false)
    }

    onSearchUpdate({
      query,
      isSearching: false,
      isGlobalSearching: true,
      tokens: globalSearchResults,
      isError: false,
    })
  }, [query, metrics, onSearchUpdate])

  const debouncedSearch = useMemo(
    () =>
      _.debounce(() => {
        performGlobalSearch()
      }, 500),
    [performGlobalSearch],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isGlobalSearching) return
      const value = e.target.value
      setQuery(value)
      onSearchUpdate({
        query: value,
        isSearching: false,
        isGlobalSearching: false,
        tokens: [],
        isError: false,
      })
      if (value.trim()) {
        debouncedSearch()
      } else {
        debouncedSearch.cancel()
      }
    },
    [isGlobalSearching, onSearchUpdate, debouncedSearch],
  )

  // Cancel debounce on unmount
  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch])

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-surface-3 dark:bg-surface-2">
        <i className="fas fa-search text-xs text-gray-400 dark:text-white/30" />
        <input
          type="search"
          placeholder={`Search ${count} tokens on ${networkName}...`}
          className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white/80 dark:placeholder:text-white/30"
          value={query}
          onChange={handleChange}
        />
        {isGlobalSearching && (
          <i className="fas fa-spinner fa-spin text-xs text-accent-500" />
        )}
        <TokenListFilter
          selectedChain={selectedChain}
          enabledLists={enabledLists}
          tokensByList={tokensByList}
          onToggleList={onToggleList}
          onToggleAll={onToggleAll}
        />
      </div>
    </div>
  )
}
