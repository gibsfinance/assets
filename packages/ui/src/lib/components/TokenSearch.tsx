import { useState, useRef, useCallback } from 'react'
import _ from 'lodash'
import { getApiUrl } from '../utils'
import { useMetricsContext } from '../contexts/MetricsContext'
import type { ListDescription, SearchUpdate, Token } from '../types'
import TokenListFilter from './TokenListFilter'

type SearchUpdateExtension = Partial<SearchUpdate>

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

/** Run async tasks with a concurrency limit. */
function limitConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function next(): Promise<void> {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    next(),
  )
  return Promise.all(workers).then(() => results)
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
  const [isSearching, setIsSearching] = useState(false)
  const [isGlobalSearching, setIsGlobalSearching] = useState(false)
  const searchAbortControllerRef = useRef<AbortController | null>(null)
  const { metrics } = useMetricsContext()

  const updateOutside = useCallback(
    (update?: SearchUpdateExtension) => {
      onSearchUpdate({
        query,
        isSearching,
        isGlobalSearching,
        tokens: [],
        isError: false,
        ...update,
      })
    },
    [onSearchUpdate, query, isSearching, isGlobalSearching],
  )

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
      const response = await fetch(getApiUrl('/list'))
      if (!response.ok) {
        onSearchUpdate({
          query,
          isSearching: false,
          isGlobalSearching: false,
          tokens: [],
          isError: true,
        })
        return
      }

      const lists = (await response.json()) as ListDescription[]
      const availableLists = lists.filter((list) => list.chainType === 'evm')
      const globalLists = availableLists.filter((list) => list.chainId === '0')
      const chainSpecificLists = availableLists.filter((list) => list.chainId !== '0')

      // Fetch global lists sequentially
      for (const list of globalLists) {
        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          console.log('Fetching global list:', url)
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
            console.log('Search aborted')
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
          console.log('Fetching chain-specific list:', url)
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
            console.log('Search aborted')
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

  const handleInput = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isGlobalSearching) return
      if (e.key === 'Enter') {
        performGlobalSearch()
        return
      }
      const value = e.currentTarget.value
      setQuery(value)
      onSearchUpdate({
        query: value,
        isSearching: false,
        isGlobalSearching: false,
        tokens: [],
        isError: false,
      })
    },
    [isGlobalSearching, performGlobalSearch, onSearchUpdate],
  )

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {/* Search bar */}
      <div className="input-group input-group-divider flex-1 grid-cols-[auto_1fr_auto] rounded-t-lg rounded-b-none flex flex-row items-center gap-2">
        <div className="input-group-shim px-2">
          <i className="fas fa-search"></i>
        </div>
        <input
          type="search"
          placeholder={`Search ${count} tokens on ${networkName}...`}
          className="input border-none ring-0 pl-0 outline-none"
          value={query}
          onKeyDown={handleInput}
          onChange={(e) => {
            if (isGlobalSearching) return
            setQuery(e.target.value)
          }}
        />
        <TokenListFilter
          selectedChain={selectedChain}
          enabledLists={enabledLists}
          tokensByList={tokensByList}
          onToggleList={onToggleList}
          onToggleAll={onToggleAll}
        />
        <button
          className={`input-group-shim variant-soft-primary flex gap-2 items-center pr-2 ${!query ? 'cursor-not-allowed' : ''}`}
          type="button"
          onClick={performGlobalSearch}
          disabled={!query}
        >
          <i className="fas fa-globe"></i>
          <span className="hidden sm:flex whitespace-pre">Search</span>
        </button>
      </div>
    </div>
  )
}
