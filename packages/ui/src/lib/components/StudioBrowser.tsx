import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import _ from 'lodash'
import { useStudio } from '../contexts/StudioContext'
import { useListEditor } from '../contexts/ListEditorContext'
import { useMetrics } from '../hooks/useMetrics'
import { useChainTokens } from '../hooks/useChainTokens'
import { useTokenBrowser } from '../hooks/useTokenBrowser'
import { getApiUrl } from '../utils'
import { toChainIdentifier, fromChainIdentifier, tokenChainIdentifier } from '../utils/chain-identifier'
import { deduplicateTokens } from '../utils/dedup-tokens'
import { searchTokens, getPopularChains } from '../utils/token-search'
import NetworkSelect from './NetworkSelect'
import TokenSearch from './TokenSearch'
import Image from './Image'
import TokenSubRows from './TokenSubRows'
import type { Token, SearchUpdate } from '../types'

interface StudioBrowserProps {
  onInspectToken: (token: Token) => void
  selectChain?: (chainId: string | null) => void
  selectToken?: (token: Token) => void
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
              }}>
              <div
                className={`group flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors border-l-2 ${
                  isSelected
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-surface-2'
                }`}
                onClick={() => onTokenClick(token)}>
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-2">
                  {hasIcon ? (
                    <Image
                      src={getApiUrl(`/image/${tokenChainIdentifier(token)}/${token.address}`)}
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
                    <span className="truncate text-sm font-medium text-gray-800 dark:text-white/90">{token.name}</span>
                    <span className="flex-shrink-0 font-mono text-[10px] text-gray-400 dark:text-white/30">
                      {token.address.slice(0, 6)}...{token.address.slice(-4)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-400 dark:text-white/40">{token.symbol}</span>
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
                      }}>
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
                  aria-label={editorOpen && activeList ? 'Add to list' : 'Inspect token'}>
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

const POPULAR_CHAIN_COUNT = 8
const ROW_HEIGHT = 44
/** Stable stand-in for "no results", so an absent search state keeps memo identity. */
const NO_TOKENS: Token[] = []

export default function StudioBrowser({
  onInspectToken,
  selectChain: selectChainProp,
  selectToken: selectTokenProp,
}: StudioBrowserProps) {
  const studio = useStudio()
  const selectedChainId = studio.selectedChainId
  const selectedToken = studio.selectedToken
  const selectToken = selectTokenProp ?? studio.selectToken
  const selectChain = selectChainProp ?? studio.selectChain
  const { metrics } = useMetrics()
  const {
    isOpen: editorOpen,
    activeList,
    addToken,
    createList,
    setActiveList,
    openEditor,
    openNewEditor,
  } = useListEditor()

  const popularChains = useMemo(() => {
    if (!metrics) return []
    return getPopularChains(metrics.networks.supported, { limit: POPULAR_CHAIN_COUNT })
  }, [metrics])

  const { enabledLists, tokensByList, toggleList, toggleAll, setListTokens, clearTokens } = useTokenBrowser()

  /* ----- Logo-only chain detection ----------------------------------------
   * Many curated chains are carried for their logo alone and have no tokens to
   * browse, so selecting one should show the logo rather than an empty grid.
   * Branch on the token count useMetrics resolved, not on whether the chain is
   * Ethereum-Virtual-Machine: that stood in as a proxy for "has no tokens" and
   * was wrong in both directions — it hid Solana's 9,633 tokens and Tron's 383,
   * while every Ethereum-Virtual-Machine chain with an empty list still fell
   * through to a bare "No tokens found". The list and image endpoints take the
   * namespaced identifier, so these chains browse like any other.
   */
  const selectedIdentifier = selectedChainId ? toChainIdentifier(selectedChainId) : null
  const selectedNetwork = useMemo(
    () => metrics?.networks.supported.find((network) => network.chainIdentifier === selectedIdentifier) ?? null,
    [metrics, selectedIdentifier],
  )
  const isLogoOnlyChain = !!selectedNetwork && selectedNetwork.tokenCount === 0

  /* ----- Local UI state -------------------------------------------------- */
  const [searchState, setSearchState] = useState<SearchUpdate | null>(null)
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set())
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(() => new Set())

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
        imageUri: token.hasIcon ? getApiUrl(`/image/${tokenChainIdentifier(token)}/${token.address}`) : undefined,
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

  /* ----- Fetch all tokens for a chain in one request --------------------- */
  const { tokens: mergedTokens, total: serverTotal, isLoading: isLoadingLists } = useChainTokens(selectedChainId)

  useEffect(() => {
    clearTokens()
    setFailedIcons(new Set())
    if (mergedTokens.length === 0) return

    setListTokens('merged', mergedTokens)
    const bySource = new Map<string, Token[]>()
    for (const token of mergedTokens) {
      for (const ref of token.listReferences ?? []) {
        const list = bySource.get(ref.sourceList)
        if (list) list.push(token)
        else bySource.set(ref.sourceList, [token])
      }
    }
    for (const [sourceList, sourceTokens] of bySource) {
      setListTokens(sourceList, sourceTokens)
    }
  }, [mergedTokens, clearTokens, setListTokens])

  /* ----- Derived --------------------------------------------------------- */
  const selectedChainNumeric = selectedChainId ? Number(fromChainIdentifier(selectedChainId)) : null

  /** Combined, deduped, sorted tokens for the selected chain */
  const chainTokens = useMemo(() => {
    if (!selectedChainId) return []

    // When data came from /list/tokens/:chainId, tokens are already deduped
    // and ordered server-side via applyOrder (list ranking → format → version)
    const merged = tokensByList.get('merged')
    if (merged) return merged

    const tokens = deduplicateTokens(tokensByList, enabledLists, selectedChainId, getApiUrl(''))
    // Client-only path: sort by popularity then alphabetical
    return tokens.sort((a, b) => {
      const popA = a.listReferences?.length ?? 1
      const popB = b.listReferences?.length ?? 1
      if (popA !== popB) return popB - popA
      return a.name.localeCompare(b.name)
    })
  }, [tokensByList, enabledLists, selectedChainId])

  const searchQuery = searchState?.query.trim() ?? ''
  // One shared empty array, so "no search yet" does not hand the memo below a new
  // dependency on every render and rebuild the list the virtualizer is measuring.
  const globalResults = searchState?.tokens ?? NO_TOKENS
  /*
   * The cross-chain search answers a different question from the local filter, so its
   * results replace the chain's list rather than being intersected with it. Narrowing
   * them to the selected chain would hide exactly the hits worth issuing the request
   * for: typing "PLS" while browsing Ethereum is a question about where that token
   * lives. Until they arrive the local filter stands in, which is what keeps the panel
   * responsive instead of blank for the length of a round trip.
   */
  const isShowingGlobalResults = !!searchQuery && globalResults.length > 0
  const filteredTokens = useMemo(() => {
    if (!searchQuery) return chainTokens
    if (isShowingGlobalResults) return globalResults
    return searchTokens(chainTokens, searchQuery)
  }, [chainTokens, searchQuery, isShowingGlobalResults, globalResults])

  // The placeholder promises a scope to search, so it has to name the list actually on
  // screen. Under a query that is however many rows are rendered; with no query the
  // server's total, which counts the tokens the virtualizer has not asked for yet.
  const tokenCount = searchQuery ? filteredTokens.length : (serverTotal ?? filteredTokens.length)
  // Only the cross-chain results can be truncated; a local filter has the whole chain.
  const isTruncated = isShowingGlobalResults && !!searchState?.truncated

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
    setExpandedTokens((prev) => {
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
      {selectedChainId && !isLogoOnlyChain && (
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
                      onClick={() => handleChainSelect(chain.chainId)}>
                      <Image
                        src={getApiUrl(`/image/${toChainIdentifier(chain.chainId)}`)}
                        size={20}
                        skeleton
                        shape="circle"
                        className="rounded-full"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-gray-800 dark:text-white/80">
                          {chain.name}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-white/30">
                          {chain.tokenCount.toLocaleString()} tokens
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {selectedChainId && isLogoOnlyChain && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <Image
              src={getApiUrl(`/image/${selectedNetwork!.chainIdentifier}`)}
              size={64}
              skeleton
              shape="circle"
              className="rounded-full"
            />
            <div className="text-sm font-medium text-gray-800 dark:text-white/80">{selectedNetwork!.name}</div>
            <p className="max-w-xs text-sm text-gray-400 dark:text-white/40">
              This chain has a logo but no tokens to browse yet.
            </p>
          </div>
        )}

        {selectedChainId && !isLogoOnlyChain && isLoadingLists && filteredTokens.length === 0 && (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/40">
            <i className="fas fa-spinner fa-spin mr-2" />
            Loading tokens...
          </div>
        )}

        {selectedChainId && !isLogoOnlyChain && !isLoadingLists && filteredTokens.length === 0 && (
          <div className="flex h-48 items-center justify-center text-sm text-gray-400 dark:text-white/30">
            No tokens found
          </div>
        )}

        {/*
         * Say so rather than presenting the first hundred as the whole answer. The
         * search stops at a candidate cap, so there is no total to show — "more matched
         * than fit" is the most the server honestly knows, and a list silently cut off
         * at a round number reads as "your token is not listed".
         */}
        {isTruncated && (
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500 dark:border-surface-3 dark:bg-surface-2 dark:text-white/40">
            <i className="fas fa-circle-info mr-1" />
            More tokens matched than are shown here. Type more of the name, symbol or address to narrow it down.
          </div>
        )}

        {!isLogoOnlyChain && filteredTokens.length > 0 && (
          <VirtualTokenList
            tokens={filteredTokens}
            selectedToken={selectedToken}
            editorOpen={editorOpen}
            activeList={activeList}
            failedIcons={failedIcons}
            expandedTokens={expandedTokens}
            onTokenClick={(token) => (editorOpen ? addTokenToEditor(token) : selectToken(token))}
            onActionClick={(token) => (editorOpen ? addTokenToEditor(token) : onInspectToken(token))}
            onToggleExpand={toggleExpand}
            onNavigateToList={openEditor}
            onIconError={handleIconError}
          />
        )}
      </div>
    </div>
  )
}
