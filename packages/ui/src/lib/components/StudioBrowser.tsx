import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import _ from 'lodash'
import { useStudio } from '../contexts/StudioContext'
import { useListEditor } from '../contexts/ListEditorContext'
import { useMetricsContext } from '../contexts/MetricsContext'
import { useTokenBrowser } from '../hooks/useTokenBrowser'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import { deduplicateTokens } from '../utils/dedup-tokens'
import NetworkSelect from './NetworkSelect'
import TokenSearch from './TokenSearch'
import PaginationControls from './PaginationControls'
import Image from './Image'
import TokenSubRows from './TokenSubRows'
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

const POPULAR_CHAIN_COUNT = 8

export default function StudioBrowser({ onInspectToken }: StudioBrowserProps) {
  const { selectedChainId, selectedToken, selectToken, selectChain } = useStudio()
  const { metrics, providers, fetchMetrics } = useMetricsContext()
  const { isOpen: editorOpen, activeList, addToken, createList, setActiveList, openEditor, openNewEditor } = useListEditor()

  useEffect(() => {
    if (!metrics) fetchMetrics()
  }, [metrics, fetchMetrics])

  const popularChains = useMemo(() => {
    if (!metrics) return []
    return metrics.networks.supported
      .map((n: { chainId: number }) => ({
        chainId: String(n.chainId),
        name: getNetworkName(n.chainId),
        tokenCount: metrics.tokenList.byChain[n.chainId] || 0,
      }))
      .filter((n: { tokenCount: number }) => n.tokenCount >= 10)
      .filter((n: { name: string }) => !n.name.toLowerCase().includes('testnet'))
      .sort((a: { tokenCount: number }, b: { tokenCount: number }) => b.tokenCount - a.tokenCount)
      .slice(0, POPULAR_CHAIN_COUNT)
  }, [metrics])

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
  const [isLoadingLists, setIsLoadingLists] = useState(false)
  const [searchState, setSearchState] = useState<SearchUpdate | null>(null)
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())
  const [availableLists, setAvailableLists] = useState<AvailableList[]>([])
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(() => new Set())

  /* Refs to avoid re-triggering effects when mutable state changes */
  const availableListsRef = useRef<AvailableList[]>([])
  availableListsRef.current = availableLists

  /** Add token to active list, or auto-create a new list first */
  const addTokenToEditor = useCallback(
    async (token: Token) => {
      const localToken = {
        chainId: typeof token.chainId === 'string' ? Number(token.chainId) : token.chainId,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals ?? 18,
        imageUri: token.hasIcon ? getApiUrl(`/image/${token.chainId}/${token.address}`) : undefined,
      }

      if (activeList) {
        const updated = await addToken(activeList.id, localToken)
        if (updated) setActiveList(updated)
        return
      }

      // No active list — create one with this token
      const newList = await createList({
        name: 'New List',
        source: { type: 'scratch' },
        tokens: [{ ...localToken, order: 0 }],
      })
      if (newList) {
        setActiveList(newList)
      }
    },
    [activeList, addToken, createList, setActiveList],
  )

  /* ----- Derived --------------------------------------------------------- */
  const selectedChainNumeric = selectedChainId ? Number(selectedChainId) : null

  const networkName = selectedChainId ? getNetworkName(selectedChainId) : ''

  /** Combined, deduped tokens for the selected chain across enabled lists */
  const filteredTokens = useMemo(() => {
    // If we have active global search results, use those
    if (searchState?.isGlobalSearching && searchState.tokens.length > 0) {
      return searchState.tokens
    }
    if (!selectedChainId) return []
    return deduplicateTokens(tokensByList, enabledLists, selectedChainId, getApiUrl(''))
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

  /* ----- Derive available lists from context providers -------------------- */
  useEffect(() => {
    if (!providers.length) return
    const uniqueLists = new Map<string, AvailableList>()
    providers.forEach((info) => {
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
  }, [providers])

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
          // list not available for this chain
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
    (chainId: string | null) => {
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

  const toggleExpand = useCallback((key: string) => {
    setExpandedTokens(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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


      {/* Token list */}
      <div className="flex-1 overflow-y-auto">
        {!selectedChainId && (
          <div className="flex flex-col items-center gap-4 px-4 py-8">
            <p className="text-sm text-gray-400 dark:text-white/30">Select a network to browse tokens</p>
            {!metrics && (
              <div className="w-full space-y-2">
                <div className="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-surface-3" />
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-surface-2" />
                  ))}
                </div>
              </div>
            )}
            {popularChains.length > 0 && (
              <div className="w-full">
                <p className="mb-2 text-xs font-medium text-gray-500 dark:text-white/40">Popular chains</p>
                <div className="grid grid-cols-2 gap-2">
                  {popularChains.map((chain) => (
                    <button
                      key={chain.chainId}
                      type="button"
                      className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left transition-all hover:border-accent-500/40 hover:bg-accent-500/5 dark:border-surface-3 dark:hover:border-accent-500/40"
                      onClick={() => handleChainSelect(chain.chainId)}
                    >
                      <Image
                        src={getApiUrl(`/image/${chain.chainId}`)}
                        size={20}
                        skeleton
                        shape="circle"
                        className="rounded-full"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-gray-800 dark:text-white/80">{chain.name}</div>
                        <div className="text-[10px] text-gray-400 dark:text-white/30">{chain.tokenCount.toLocaleString()} tokens</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
                <div key={iconKey}>
                  <div
                    className={`group flex cursor-pointer items-center gap-3 px-3 py-2 transition-all border-l-2 ${
                      isSelected
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-transparent hover:bg-gray-50 dark:hover:bg-surface-2'
                    }`}
                    onClick={() => {
                      if (editorOpen) {
                        addTokenToEditor(token)
                      } else {
                        selectToken(token)
                      }
                    }}
                  >
                    {/* Icon */}
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-2">
                      {hasIcon ? (
                        <Image
                          src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                          alt={token.symbol}
                          className="rounded-full object-contain"
                          size={28}
                          skeleton
                          lazy
                          shape="circle"
                          onError={() => handleIconError(token)}
                        />
                      ) : (
                        <span className="text-xs font-bold text-gray-300 dark:text-white/30">
                          {token.symbol.slice(0, 2)}
                        </span>
                      )}
                    </div>

                    {/* Name/Address (top) + Symbol/List (bottom) */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                          {token.name}
                        </span>
                        <span className="flex-shrink-0 font-mono text-[10px] text-gray-400 dark:text-white/30">
                          {token.address.slice(0, 6)}...{token.address.slice(-4)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-400 dark:text-white/40">
                          {token.symbol}
                        </span>
                        <button
                          type="button"
                          className="flex items-center gap-1 truncate text-[10px] text-accent-500/70 hover:text-accent-500"
                          onClick={(e) => {
                            e.stopPropagation()
                            if ((token.listReferences?.length ?? 0) > 1) {
                              toggleExpand(iconKey)
                            } else {
                              openEditor(token.sourceList)
                            }
                          }}
                        >
                          <span className="truncate hover:underline">{token.sourceList}</span>
                          {(token.listReferences?.length ?? 0) > 1 && (
                            <>
                              <span className="flex-shrink-0 rounded bg-gray-100 px-1 py-px text-[9px] text-gray-500 dark:bg-surface-2 dark:text-white/40">
                                +{token.listReferences!.length - 1}
                              </span>
                              <i className={`fas fa-chevron-${expandedTokens.has(iconKey) ? 'up' : 'down'} flex-shrink-0 text-[7px] text-gray-400 dark:text-white/30`} />
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Action button: + when editor open (always visible), info otherwise */}
                    <button
                      type="button"
                      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-all ${
                        editorOpen
                          ? 'text-accent-500/60 hover:bg-accent-500/10 hover:text-accent-500'
                          : 'text-gray-300 opacity-0 hover:bg-accent-500/10 hover:text-accent-500 group-hover:opacity-100 dark:text-white/20'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (editorOpen) {
                          addTokenToEditor(token)
                        } else {
                          onInspectToken(token)
                        }
                      }}
                      title={editorOpen && activeList ? 'Add to list' : 'Inspect token'}
                      aria-label={editorOpen && activeList ? 'Add to list' : 'Inspect token'}
                    >
                      <i className={`fas ${editorOpen && activeList ? 'fa-plus' : 'fa-info-circle'} text-sm`} />
                    </button>
                  </div>

                  {/* Expanded sub-rows */}
                  {expandedTokens.has(iconKey) && token.listReferences && (
                    <TokenSubRows references={token.listReferences} onNavigateToList={openEditor} />
                  )}
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
