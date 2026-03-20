import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import _ from 'lodash'
import { useStudio } from '../contexts/StudioContext'
import { useTokenBrowser } from '../hooks/useTokenBrowser'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import NetworkSelect from './NetworkSelect'
import TokenSearch from './TokenSearch'
import PaginationControls from './PaginationControls'
import Image from './Image'
import type { Token, SearchUpdate } from '../types'

interface StudioBrowserProps {
  onInspectToken: (token: Token) => void
}

interface AvailableList {
  key: string
  name: string
  providerKey: string
  chainId: string
  type: string
  default: boolean
}

const TOKENS_PER_PAGE = 25

export default function StudioBrowser({ onInspectToken }: StudioBrowserProps) {
  const { selectedChainId, selectedToken, selectToken, selectChain } = useStudio()

  const {
    enabledLists,
    tokensByList,
    toggleList,
    toggleAll,
    setListTokens,
    clearTokens,
  } = useTokenBrowser()

  /* ----- Local UI state -------------------------------------------------- */
  const [currentPage, setCurrentPage] = useState(1)
  const [showMetadata, setShowMetadata] = useState(false)
  const [isLoadingLists, setIsLoadingLists] = useState(false)
  const [searchState, setSearchState] = useState<SearchUpdate | null>(null)
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())
  const [availableLists, setAvailableLists] = useState<AvailableList[]>([])

  /* Refs to avoid re-triggering effects when mutable state changes */
  const availableListsRef = useRef<AvailableList[]>([])
  availableListsRef.current = availableLists

  /* ----- Derived --------------------------------------------------------- */
  const selectedChainNumeric = selectedChainId ? Number(selectedChainId) : null

  const networkName = selectedChainId ? getNetworkName(selectedChainId) : ''

  /** Combined, deduped tokens for the selected chain across enabled lists */
  const filteredTokens = useMemo(() => {
    // If we have active global search results, use those
    if (searchState?.isGlobalSearching && searchState.tokens.length > 0) {
      return searchState.tokens
    }

    const tokenMap = new Map<string, Token>()

    // Non-bridge tokens first
    for (const [listKey, tokens] of tokensByList.entries()) {
      if (!enabledLists.has(listKey) || listKey.includes('bridge')) continue
      for (const token of tokens) {
        if (token.chainId.toString() !== selectedChainId) continue
        if (!token.hasIcon) continue
        const key = `${token.chainId}-${token.address.toLowerCase()}`
        if (!tokenMap.has(key)) tokenMap.set(key, token)
      }
    }

    // Bridge tokens only if not already present
    for (const [listKey, tokens] of tokensByList.entries()) {
      if (!enabledLists.has(listKey) || !listKey.includes('bridge')) continue
      for (const token of tokens) {
        if (token.chainId.toString() !== selectedChainId) continue
        if (!token.hasIcon) continue
        const key = `${token.chainId}-${token.address.toLowerCase()}`
        if (!tokenMap.has(key)) tokenMap.set(key, token)
      }
    }

    return Array.from(tokenMap.values())
  }, [tokensByList, enabledLists, selectedChainId, searchState])

  const tokenCount = useMemo(() => {
    const list = Array.from(tokensByList.entries())
    const underChain = list.filter(([, tokens]) =>
      tokens.some((t) => t.chainId === selectedChainNumeric),
    )
    return _(underChain)
      .flatMap(([, tkns]) => tkns)
      .uniqBy((v) => v.address.toLowerCase())
      .value().length
  }, [tokensByList, selectedChainNumeric])

  const paginatedTokens = useMemo(() => {
    const start = (currentPage - 1) * TOKENS_PER_PAGE
    return filteredTokens.slice(start, start + TOKENS_PER_PAGE)
  }, [filteredTokens, currentPage])

  /* ----- Fetch available lists on mount ---------------------------------- */
  useEffect(() => {
    let cancelled = false

    async function fetchLists() {
      try {
        const response = await fetch(getApiUrl('/list'))
        if (cancelled || !response.ok) return

        const data = await response.json()
        if (cancelled) return

        const uniqueLists = new Map<string, AvailableList>()
        data.forEach((info: Record<string, unknown>) => {
          const key = `${info.providerKey}-${info.key}-${info.chainId}`
          if (!uniqueLists.has(key)) {
            uniqueLists.set(key, {
              key: info.key as string,
              name: (info.name as string) || (info.key as string),
              providerKey: info.providerKey as string,
              chainId: info.chainId?.toString() || '0',
              type: (info.type as string) || 'hosted',
              default: (info.default as boolean) || false,
            })
          }
        })
        setAvailableLists(Array.from(uniqueLists.values()))
      } catch (error) {
        console.error('Failed to fetch available lists:', error)
      }
    }

    fetchLists()
    return () => {
      cancelled = true
    }
  }, [])

  /* ----- Fetch token lists when chain changes ---------------------------- */
  const processListWithRetry = useCallback(
    async (list: AvailableList, chainId: number) => {
      try {
        const url =
          list.chainId === '0'
            ? getApiUrl(`/list/${list.providerKey}/${list.key}`)
            : getApiUrl(`/list/${list.providerKey}/${list.key}?chainId=${chainId}`)

        const response = await fetch(url)

        if (response.ok) {
          const data = await response.json()
          if (data?.tokens && Array.isArray(data.tokens)) {
            const tokens: Token[] = data.tokens.map((token: Token) => ({
              ...token,
              hasIcon: true,
              sourceList: `${list.providerKey}/${list.key}`,
              isBridgeToken: list.providerKey.includes('bridge'),
            }))
            const listKey = `${list.providerKey}/${list.key}`
            setListTokens(listKey, tokens)
          }
        } else if (response.status === 404) {
          console.log(`List ${list.providerKey}/${list.key} not available for chain ${chainId}`)
          toggleList(`${list.providerKey}/${list.key}`, false)
        } else {
          console.error(
            `Failed to fetch list ${list.providerKey}/${list.key}: ${response.status} ${response.statusText}`,
          )
        }
      } catch (error) {
        console.error(`Network error fetching list ${list.name}:`, error)
      }
    },
    [setListTokens, toggleList],
  )

  const tryFetchTokenLists = useCallback(
    async (chainId: number) => {
      const lists = availableListsRef.current
      const relevantLists = lists.filter(
        (list) => list.chainId === chainId.toString() || list.chainId === '0',
      )

      clearTokens()
      setIsLoadingLists(true)
      setCurrentPage(1)
      setFailedIcons(new Set())

      // Process lists in batches of 2
      const batchSize = 2
      for (let i = 0; i < relevantLists.length; i += batchSize) {
        const batch = relevantLists.slice(i, i + batchSize)
        await Promise.all(batch.map((list) => processListWithRetry(list, chainId)))
      }

      setIsLoadingLists(false)
    },
    [clearTokens, processListWithRetry],
  )

  useEffect(() => {
    if (!selectedChainId) return
    tryFetchTokenLists(Number(selectedChainId))
  }, [selectedChainId, tryFetchTokenLists])

  /* ----- Handlers -------------------------------------------------------- */
  const handleChainSelect = useCallback(
    (chainId: string) => {
      selectChain(chainId)
      setSearchState(null)
    },
    [selectChain],
  )

  const handleToggleList = useCallback(
    (listKey: string, enabled: boolean) => {
      toggleList(listKey, enabled)
      setCurrentPage(1)
    },
    [toggleList],
  )

  const handleToggleAll = useCallback(
    (enabled: boolean) => {
      toggleAll(enabled)
      setCurrentPage(1)
    },
    [toggleAll],
  )

  const handleSearchUpdate = useCallback((state: SearchUpdate) => {
    setSearchState(state)
    setCurrentPage(1)
  }, [])

  const handleIconError = useCallback((token: Token) => {
    setFailedIcons((prev) => {
      const next = new Set(prev)
      next.add(`${token.chainId}-${token.address}`)
      return next
    })
  }, [])

  /* ----- Render ---------------------------------------------------------- */
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      {/* Network selector */}
      <NetworkSelect selectedChainId={selectedChainId} onSelect={handleChainSelect} />

      {/* Search + filter (TokenSearch embeds TokenListFilter internally) */}
      {selectedChainId && (
        <TokenSearch
          count={tokenCount}
          networkName={networkName}
          onSearchUpdate={handleSearchUpdate}
          selectedChain={selectedChainNumeric}
          enabledLists={enabledLists}
          tokensByList={tokensByList}
          onToggleList={handleToggleList}
          onToggleAll={handleToggleAll}
        />
      )}

      {/* Metadata toggle + pagination header */}
      {selectedChainId && (
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-500 dark:text-white/50">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border-light bg-gray-50 text-accent-500 focus:ring-accent-500/30 dark:border-border-dark dark:bg-surface-2"
              checked={showMetadata}
              onChange={(e) => setShowMetadata(e.target.checked)}
            />
            Metadata
          </label>

          <PaginationControls
            currentPage={currentPage}
            totalItems={filteredTokens.length}
            tokensPerPage={TOKENS_PER_PAGE}
            onPageChange={setCurrentPage}
          />
        </div>
      )}

      {/* Token list */}
      <div className="flex-1 overflow-y-auto">
        {!selectedChainId && (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/30">
            Select a network to browse tokens
          </div>
        )}

        {selectedChainId && isLoadingLists && filteredTokens.length === 0 && (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/40">
            <i className="fas fa-spinner fa-spin mr-2" />
            Loading tokens...
          </div>
        )}

        {selectedChainId && !isLoadingLists && filteredTokens.length === 0 && (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/30">
            No tokens found
          </div>
        )}

        {paginatedTokens.length > 0 && (
          <div className="flex flex-col gap-px">
            {paginatedTokens.map((token) => {
              const iconKey = `${token.chainId}-${token.address}`
              const hasIcon = token.hasIcon && !failedIcons.has(iconKey)
              const isSelected =
                selectedToken?.address.toLowerCase() === token.address.toLowerCase() &&
                selectedToken?.chainId.toString() === token.chainId.toString()

              return (
                <div
                  key={iconKey}
                  className={`group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-all ${
                    isSelected
                      ? 'bg-accent-500/10 shadow-glow-green-subtle ring-1 ring-accent-500/30'
                      : 'hover:bg-gray-100 dark:hover:bg-surface-2'
                  }`}
                  onClick={() => selectToken(token)}
                >
                  {/* Icon */}
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-2">
                    {hasIcon ? (
                      <Image
                        src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                        alt={token.symbol}
                        className="rounded-full object-contain"
                        size={28}
                        onError={() => handleIconError(token)}
                      />
                    ) : (
                      <span className="text-xs font-bold text-gray-300 dark:text-white/30">
                        {token.symbol.slice(0, 2)}
                      </span>
                    )}
                  </div>

                  {/* Name + symbol */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                      {token.name}
                    </span>
                    <span className="truncate text-xs text-gray-400 dark:text-white/40">
                      {token.symbol}
                      {showMetadata && (
                        <> &middot; {token.address.slice(0, 6)}...{token.address.slice(-4)}</>
                      )}
                    </span>
                    {showMetadata && (
                      <span className="text-[10px] text-gray-300 dark:text-white/25">
                        {token.sourceList}
                      </span>
                    )}
                  </div>

                  {/* Inspect button */}
                  <button
                    type="button"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-300 opacity-0 transition-all hover:bg-accent-500/10 hover:text-accent-500 group-hover:opacity-100 dark:text-white/20"
                    onClick={(e) => {
                      e.stopPropagation()
                      onInspectToken(token)
                    }}
                    title="Inspect token"
                  >
                    <i className="fas fa-info-circle text-sm" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Bottom pagination (visible when there are tokens) */}
      {filteredTokens.length > TOKENS_PER_PAGE && (
        <div className="flex items-center justify-between border-t border-border-light pt-3 dark:border-border-dark">
          <span className="text-xs text-gray-400 dark:text-white/30">
            {filteredTokens.length} tokens
          </span>
          <PaginationControls
            currentPage={currentPage}
            totalItems={filteredTokens.length}
            tokensPerPage={TOKENS_PER_PAGE}
            onPageChange={setCurrentPage}
          />
        </div>
      )}
    </div>
  )
}
