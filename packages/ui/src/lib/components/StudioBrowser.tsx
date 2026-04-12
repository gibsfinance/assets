import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import _ from 'lodash'
import { useStudio } from '../contexts/StudioContext'
import { useListEditor } from '../contexts/ListEditorContext'
import { useMetricsContext } from '../contexts/MetricsContext'
import { useTokenBrowser } from '../hooks/useTokenBrowser'
import { getApiUrl } from '../utils'
import { getNetworkName } from '../utils/network-name'
import { deduplicateTokens } from '../utils/dedup-tokens'
import { filterTokensBySearch, getPopularChains } from '../utils/token-search'
import NetworkSelect from './NetworkSelect'
import TokenSearch from './TokenSearch'
import Image from './Image'
import TokenSubRows from './TokenSubRows'
import type { Token, SearchUpdate } from '../types'

interface StudioBrowserProps {
  onInspectToken: (token: Token) => void
}

// ---------------------------------------------------------------------------
// Virtualized token list — only renders visible rows
// ---------------------------------------------------------------------------

interface VirtualTokenListProps {
  tokens: Token[]
  selectedToken: Token | null
  editorOpen: boolean
  activeList: unknown
  failedIcons: Set<string>
  expandedTokens: Set<string>
  onTokenClick: (token: Token) => void
  onActionClick: (token: Token) => void
  onToggleExpand: (key: string) => void
  onNavigateToList: (sourceList: string) => void
  onIconError: (token: Token) => void
}

function VirtualTokenList({
  tokens,
  selectedToken,
  editorOpen,
  activeList,
  failedIcons,
  expandedTokens,
  onTokenClick,
  onActionClick,
  onToggleExpand,
  onNavigateToList,
  onIconError,
}: VirtualTokenListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: tokens.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Re-measure when tokens expand/collapse so rows below reflow
  useEffect(() => {
    virtualizer.measure()
  }, [expandedTokens, virtualizer])

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto" style={{ contain: 'layout style' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const token = tokens[virtualRow.index]
          const iconKey = `${token.chainId}-${token.address}`
          const hasIcon = token.hasIcon && !failedIcons.has(iconKey)
          const isSelected =
            selectedToken?.address.toLowerCase() === token.address.toLowerCase() &&
            selectedToken?.chainId.toString() === token.chainId.toString()

          return (
            <div
              key={iconKey}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className={`group flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors border-l-2 ${
                  isSelected
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-surface-2'
                }`}
                onClick={() => onTokenClick(token)}
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-2">
                  {hasIcon ? (
                    <Image
                      src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                      alt={token.symbol}
                      className="rounded-full object-contain"
                      size={28}
                      skeleton
                      shape="circle"
                      onError={() => onIconError(token)}
                    />
                  ) : (
                    <span className="text-xs font-bold text-gray-300 dark:text-white/30">
                      {token.symbol.slice(0, 2)}
                    </span>
                  )}
                </div>

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
                          onToggleExpand(iconKey)
                        } else {
                          onNavigateToList(token.sourceList)
                        }
                      }}
                    >
                      <span className="truncate hover:underline">{token.sourceList}</span>
                      {(token.listReferences?.length ?? 0) > 1 && (
                        <span className="flex-shrink-0 rounded bg-gray-100 px-1 py-px text-[9px] text-gray-500 dark:bg-surface-2 dark:text-white/40">
                          +{token.listReferences!.length - 1}
                        </span>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-all ${
                    editorOpen
                      ? 'text-accent-500/60 hover:bg-accent-500/10 hover:text-accent-500'
                      : 'text-gray-300 opacity-0 hover:bg-accent-500/10 hover:text-accent-500 group-hover:opacity-100 dark:text-white/20'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onActionClick(token)
                  }}
                  title={editorOpen && activeList ? 'Add to list' : 'Inspect token'}
                  aria-label={editorOpen && activeList ? 'Add to list' : 'Inspect token'}
                >
                  <i className={`fas ${editorOpen && activeList ? 'fa-plus' : 'fa-info-circle'} text-sm`} />
                </button>
              </div>

              {expandedTokens.has(iconKey) && token.listReferences && (
                <TokenSubRows references={token.listReferences} onNavigateToList={onNavigateToList} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface AvailableList {
  key: string
  name: string
  providerKey: string
  chainId: string
  type?: string
  default: boolean
}

const POPULAR_CHAIN_COUNT = 8
const ROW_HEIGHT = 44

export default function StudioBrowser({ onInspectToken }: StudioBrowserProps) {
  const { selectedChainId, selectedToken, selectToken, selectChain } = useStudio()
  const { metrics, providers, fetchMetrics } = useMetricsContext()
  const { isOpen: editorOpen, activeList, addToken, createList, setActiveList, openEditor, openNewEditor } = useListEditor()

  useEffect(() => {
    if (!metrics) fetchMetrics()
  }, [metrics, fetchMetrics])

  const popularChains = useMemo(() => {
    if (!metrics) return []
    return getPopularChains(metrics.networks.supported, metrics.tokenList.byChain, getNetworkName, {
      limit: POPULAR_CHAIN_COUNT,
    })
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
  const [isLoadingLists, setIsLoadingLists] = useState(false)
  const [searchState, setSearchState] = useState<SearchUpdate | null>(null)
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(() => new Set())
  /** Server-authoritative total token count for the selected chain */
  const [serverTotal, setServerTotal] = useState<number | null>(null)

  /* ----- Derive available lists from context providers -------------------- */
  const availableLists = useMemo(() => {
    if (!providers.length) return []
    const uniqueLists = new Map<string, AvailableList>()
    providers.forEach((info) => {
      const key = `${info.providerKey}-${info.key}-${info.chainId}`
      if (!uniqueLists.has(key)) {
        uniqueLists.set(key, {
          key: info.key as string,
          name: (info.name as string) || (info.key as string),
          providerKey: info.providerKey as string,
          chainId: info.chainId?.toString() || '0',
          type: (info.chainType as string) || 'hosted',
          default: (info.default as boolean) || false,
        })
      }
    })
    return Array.from(uniqueLists.values())
  }, [providers])

  // availableLists retained for TokenSearch global search fallback

  /** Add token to active list, or auto-create a new list first */
  const creatingListRef = useRef(false)
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

      // Prevent race: multiple rapid clicks creating duplicate lists
      if (creatingListRef.current) return
      creatingListRef.current = true
      try {
        const newList = await createList({
          name: 'New List',
          source: { type: 'scratch' },
          tokens: [{ ...localToken, order: 0 }],
        })
        if (newList) setActiveList(newList)
      } finally {
        creatingListRef.current = false
      }
    },
    [activeList, addToken, createList, setActiveList],
  )

  /* ----- Derived --------------------------------------------------------- */
  const selectedChainNumeric = selectedChainId ? Number(selectedChainId) : null

  /** Combined, deduped, sorted tokens for the selected chain */
  const filteredTokens = useMemo(() => {
    let tokens: Token[]
    if (!selectedChainId) {
      return []
    }

    // When data came from /list/tokens/:chainId, tokens are already deduped
    // and ordered server-side via applyOrder (list ranking → format → version)
    const merged = tokensByList.get('merged')
    if (merged) {
      tokens = merged
    } else {
      tokens = deduplicateTokens(tokensByList, enabledLists, selectedChainId, getApiUrl(''))
      // Client-only path: sort by popularity then alphabetical
      tokens.sort((a, b) => {
        const popA = a.listReferences?.length ?? 1
        const popB = b.listReferences?.length ?? 1
        if (popA !== popB) return popB - popA
        return a.name.localeCompare(b.name)
      })
    }

    // Filter by search query
    const query = searchState?.query?.trim() || ''
    if (query) {
      tokens = filterTokensBySearch(tokens, query)
    }

    return tokens
  }, [tokensByList, enabledLists, selectedChainId, searchState])

  const hasSearchQuery = !!searchState?.query?.trim()
  const tokenCount = hasSearchQuery ? filteredTokens.length : (serverTotal ?? filteredTokens.length)

  /* ----- Fetch all tokens for a chain in one request --------------------- */
  const fetchingChainRef = useRef<number | null>(null)
  const tryFetchTokenLists = useCallback(
    async (chainId: number) => {
      if (fetchingChainRef.current === chainId) return
      fetchingChainRef.current = chainId
      clearTokens()
      setIsLoadingLists(true)
      setServerTotal(null)
      setFailedIcons(new Set())

      try {
        const response = await fetch(getApiUrl(`/list/tokens/${chainId}`))
        if (!response.ok) throw new Error(`${response.status}`)

        const data = await response.json()
        if (typeof data?.total === 'number') {
          setServerTotal(data.total)
        }
        if (data?.tokens && Array.isArray(data.tokens)) {
          interface ApiToken {
            chainId: number
            address: string
            name: string
            symbol: string
            decimals: number
            logoURI?: string
            sources?: string[]
          }
          const tokens: Token[] = data.tokens.map((token: ApiToken) => {
            const sources = token.sources ?? []
            const primarySource = sources[0] ?? 'merged'
            const listReferences = sources.map((src) => ({
              sourceList: src,
              imageUri: getApiUrl(`/image/${token.chainId}/${token.address}`),
              imageFormat: '',
            }))
            return {
              chainId: token.chainId,
              address: token.address,
              name: token.name,
              symbol: token.symbol,
              decimals: token.decimals,
              hasIcon: !!token.logoURI,
              sourceList: primarySource,
              listReferences: listReferences.length > 0 ? listReferences : undefined,
            }
          })
          setListTokens('merged', tokens)
        }
      } catch (error) {
        console.error('Failed to fetch tokens for chain:', error)
      } finally {
        fetchingChainRef.current = null
      }

      setIsLoadingLists(false)
    },
    [clearTokens, setListTokens],
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
      
    },
    [toggleList],
  )

  const handleToggleAll = useCallback(
    (enabled: boolean) => {
      toggleAll(enabled)
      
    },
    [toggleAll],
  )

  const handleSearchUpdate = useCallback((state: SearchUpdate) => {
    setSearchState(state)
    
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
    <div className="flex h-full flex-col">
      {/* Network selector */}
      <NetworkSelect selectedChainId={selectedChainId} onSelect={handleChainSelect} />

      {/* Search + filter (TokenSearch embeds TokenListFilter internally) */}
      {selectedChainId && (
        <TokenSearch
          count={tokenCount}
          onSearchUpdate={handleSearchUpdate}
          selectedChain={selectedChainNumeric}
          enabledLists={enabledLists}
          tokensByList={tokensByList}
          onToggleList={handleToggleList}
          onToggleAll={handleToggleAll}
        />
      )}


      {/* Token list */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedChainId && (
          <div className="flex flex-col items-center gap-4 px-4 py-3">
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

        {filteredTokens.length > 0 && (
          <VirtualTokenList
            tokens={filteredTokens}
            selectedToken={selectedToken}
            editorOpen={editorOpen}
            activeList={activeList}
            failedIcons={failedIcons}
            expandedTokens={expandedTokens}
            onTokenClick={(token) => editorOpen ? addTokenToEditor(token) : selectToken(token)}
            onActionClick={(token) => editorOpen ? addTokenToEditor(token) : onInspectToken(token)}
            onToggleExpand={toggleExpand}
            onNavigateToList={openEditor}
            onIconError={handleIconError}
          />
        )}

      </div>
    </div>
  )
}
