import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { ApiType, NetworkInfo, Token, SearchUpdate } from '../types'
import { getApiUrl, initializeApiBase } from '../utils'
import { useSettings } from '../contexts/SettingsContext'
import { useMetricsContext } from '../contexts/MetricsContext'
import { useTokenBrowser } from '../hooks/useTokenBrowser'
import ApiTypeSelector from '../components/ApiTypeSelector'
import NetworkSelect from '../components/NetworkSelect'
import TokenBrowser from '../components/TokenBrowser'
import TokenSearch from '../components/TokenSearch'
import TokenAddressInput from '../components/TokenAddressInput'
import TokenListSelector from '../components/TokenListSelector'
import TokenPreview, { type TokenPreviewHandle } from '../components/TokenPreview'
import UrlDisplay from '../components/UrlDisplay'
import ErrorMessage from '../components/ErrorMessage'
import _ from 'lodash'

interface AvailableList {
  key: string
  name: string
  providerKey: string
  chainId: string
  type: string
  default: boolean
}

export default function Wizard() {
  const { showTestnets: _showTestnets } = useSettings()
  const { fetchMetrics } = useMetricsContext()

  const { enabledLists, tokensByList, toggleList, toggleAll, setListTokens, clearTokens } =
    useTokenBrowser()

  const previewRef = useRef<TokenPreviewHandle>(null)

  // Core state
  const [selectedChain, setSelectedChain] = useState<number | null>(null)
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkInfo | null>(null)
  const [urlType, setUrlType] = useState<ApiType>('token')
  const [tokenAddress, setTokenAddress] = useState('')
  const [generatedUrl, setGeneratedUrl] = useState('')
  const [listName, setListName] = useState('default')

  // Preview state
  const [previewError, setPreviewError] = useState(false)
  const [iconExists, setIconExists] = useState(true)
  const [isCircularCrop, setIsCircularCrop] = useState(false)
  const [backgroundColor, setBackgroundColor] = useState('#2b4f54')
  const [showColorPicker, setShowColorPicker] = useState(false)

  // Token browser state
  const [_allTokens, setAllTokens] = useState<Token[]>([])
  const [filteredTokens, setFilteredTokens] = useState<Token[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [tokensPerPage, setTokensPerPage] = useState(25)
  const [_currentSearchState, setCurrentSearchState] = useState<SearchUpdate | null>(null)

  // Lists state
  const [availableLists, setAvailableLists] = useState<AvailableList[]>([])
  const [selectedList, setSelectedList] = useState<{ key: string; providerKey: string } | null>(
    null,
  )

  // Initialization
  const [isInitialized, setIsInitialized] = useState(false)

  // Network name resolver
  const [getNetworkNameFn, setGetNetworkNameFn] = useState<(id: string | number) => string>(
    () => (chainId: string | number) => `Chain ${chainId}`,
  )

  // Ref to hold availableLists for use inside the chain-fetch effect without
  // re-triggering it every time the list changes.
  const availableListsRef = useRef<AvailableList[]>([])
  availableListsRef.current = availableLists

  // Ref-backed helpers so callbacks always see the latest state without
  // needing those values in dependency arrays.
  const enabledListsRef = useRef(enabledLists)
  enabledListsRef.current = enabledLists

  const tokensByListRef = useRef(tokensByList)
  tokensByListRef.current = tokensByList

  const selectedChainRef = useRef(selectedChain)
  selectedChainRef.current = selectedChain

  // ---------------------------------------------------------------------------
  // URL Generation
  // ---------------------------------------------------------------------------

  const generateUrl = useCallback(
    (overrides?: { chain?: number | null; address?: string; type?: ApiType; list?: string }) => {
      const chain = overrides?.chain ?? selectedChain
      const address = overrides?.address ?? tokenAddress
      const type = overrides?.type ?? urlType
      const list = overrides?.list ?? listName

      setPreviewError(false)
      setIconExists(true)

      switch (type) {
        case 'network':
          if (chain) {
            setGeneratedUrl(getApiUrl(`/image/${chain}`))
          }
          break
        case 'token':
          if (chain && address) {
            setGeneratedUrl(getApiUrl(`/image/${chain}/${address}`))
          }
          break
        case 'list': {
          const [providerKey, listKey = 'default'] = list.split('/')
          if (chain) {
            setGeneratedUrl(getApiUrl(`/list/${providerKey}/${listKey}?chainId=${chain}`))
          } else {
            setGeneratedUrl(getApiUrl(`/list/${providerKey}/${listKey}`))
          }
          break
        }
      }
    },
    [selectedChain, tokenAddress, urlType, listName],
  )

  // ---------------------------------------------------------------------------
  // Token list combining / dedup
  // ---------------------------------------------------------------------------

  const updateCombinedTokenList = useCallback(() => {
    const currentEnabledLists = enabledListsRef.current
    const currentTokensByList = tokensByListRef.current
    const chain = selectedChainRef.current

    const tokenMap = new Map<string, Token>()

    // First add non-bridge tokens
    for (const [listKey, tokens] of currentTokensByList.entries()) {
      if (currentEnabledLists.has(listKey) && !listKey.includes('bridge')) {
        for (const token of tokens) {
          const key = `${token.chainId}-${token.address.toLowerCase()}`
          if (!tokenMap.has(key) && token.hasIcon) {
            tokenMap.set(key, token)
          }
        }
      }
    }

    // Then add bridge tokens only if they don't already exist
    for (const [listKey, tokens] of currentTokensByList.entries()) {
      if (currentEnabledLists.has(listKey) && listKey.includes('bridge')) {
        for (const token of tokens) {
          const key = `${token.chainId}-${token.address.toLowerCase()}`
          if (!tokenMap.has(key) && token.hasIcon) {
            tokenMap.set(key, token)
          }
        }
      }
    }

    const combined = Array.from(tokenMap.values())
    setAllTokens(combined)
    setFilteredTokens(combined.filter((token) => token.chainId.toString() === chain?.toString()))
    setCurrentPage(1)
  }, [])

  // ---------------------------------------------------------------------------
  // Fetch a single token list with error handling
  // ---------------------------------------------------------------------------

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
            // updateCombinedTokenList will be triggered by the effect watching
            // tokensByList changes — but since setListTokens is batched we
            // call it manually here so incremental results appear immediately.
            // We need a micro-delay for the state to settle.
            setTimeout(updateCombinedTokenList, 0)
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
    [setListTokens, toggleList, updateCombinedTokenList],
  )

  // ---------------------------------------------------------------------------
  // Fetch all token lists for a chain
  // ---------------------------------------------------------------------------

  const tryFetchTokenLists = useCallback(
    async (chainId: number) => {
      const lists = availableListsRef.current
      const relevantLists = lists.filter(
        (list) => list.chainId === chainId.toString() || list.chainId === '0',
      )

      // Clear previous tokens
      clearTokens()
      setAllTokens([])
      setFilteredTokens([])

      // Process lists in batches of 2
      const batchSize = 2
      for (let i = 0; i < relevantLists.length; i += batchSize) {
        const batch = relevantLists.slice(i, i + batchSize)
        await Promise.all(batch.map((list) => processListWithRetry(list, chainId)))
      }
    },
    [clearTokens, processListWithRetry],
  )

  // ---------------------------------------------------------------------------
  // Initialization effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      initializeApiBase()
      if (cancelled) return

      setIsInitialized(true)
      fetchMetrics()

      // Fetch available lists
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

    initialize()

    return () => {
      cancelled = true
    }
  }, [])

  // ---------------------------------------------------------------------------
  // When selectedNetwork changes and we're in token mode, fetch token lists
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (selectedNetwork && urlType === 'token') {
      tryFetchTokenLists(selectedNetwork.chainId)
    }
  }, [selectedNetwork, urlType])

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const list = useMemo(() => Array.from(tokensByList.entries()), [tokensByList])

  const underChain = useMemo(
    () =>
      list.filter(([, tokens]) => {
        const tokensForNetwork = tokens.filter((token) => token.chainId === selectedChain)
        return tokensForNetwork.length > 0
      }),
    [list, selectedChain],
  )

  const tokenCount = useMemo(
    () =>
      _(underChain)
        .flatMap(([, tkns]) => tkns)
        .uniqBy((v) => v.address.toLowerCase())
        .value().length,
    [underChain],
  )

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSelectNetwork = useCallback(
    (network: NetworkInfo) => {
      setSelectedChain(network.chainId)
      setSelectedNetwork(network)
      generateUrl({ chain: network.chainId })

      if (urlType === 'token') {
        tryFetchTokenLists(network.chainId)
      }
    },
    [generateUrl, urlType, tryFetchTokenLists],
  )

  const handleTokenListToggle = useCallback(
    (listKey: string, enabled: boolean) => {
      toggleList(listKey, enabled)
      setTimeout(updateCombinedTokenList, 0)
    },
    [toggleList, updateCombinedTokenList],
  )

  const handleTokenListToggleAll = useCallback(
    (enabled: boolean) => {
      toggleAll(enabled)
      setTimeout(updateCombinedTokenList, 0)
    },
    [toggleAll, updateCombinedTokenList],
  )

  const handleApiTypeSelect = useCallback(
    (type: ApiType) => {
      setUrlType(type)
      setGeneratedUrl('')
      setPreviewError(false)
      setTokenAddress('')
    },
    [],
  )

  const handleApiTypeLoadTokens = useCallback(() => {
    if (selectedNetwork) {
      tryFetchTokenLists(selectedNetwork.chainId)
    }
  }, [selectedNetwork, tryFetchTokenLists])

  const handleApiTypeGenerate = useCallback(() => {
    if (selectedNetwork) {
      generateUrl({ chain: selectedNetwork.chainId })
    }
  }, [selectedNetwork, generateUrl])

  const handleApiTypeReset = useCallback(() => {
    setGeneratedUrl('')
    setTokenAddress('')
    setPreviewError(false)
  }, [])

  const handleListSelect = useCallback(
    (selection: { key: string; providerKey: string }) => {
      setSelectedList(selection)
      const name = `${selection.providerKey}/${selection.key}`
      setListName(name)
      generateUrl({ list: name })
    },
    [generateUrl],
  )

  const handleSelectToken = useCallback(
    (token: Token) => {
      setTokenAddress(token.address)
      generateUrl({ address: token.address })
    },
    [generateUrl],
  )

  const handleTokenAddressBack = useCallback(() => {
    setTokenAddress('')
    setGeneratedUrl('')
    setPreviewError(false)
    setIconExists(true)
  }, [])

  const handleTokenAddressInput = useCallback(
    (address: string) => {
      setTokenAddress(address)
      generateUrl({ address })
    },
    [generateUrl],
  )

  const handleNetworkName = useCallback((fn: (id: string | number) => string) => {
    setGetNetworkNameFn(() => fn)
  }, [])

  const resetForm = useCallback(() => {
    if (urlType === 'token' && tokenAddress) {
      // Only reset the preview state, maintaining token selection
      previewRef.current?.resetPreview()
      generateUrl()
    } else {
      // Full reset
      setSelectedChain(null)
      setTokenAddress('')
      setGeneratedUrl('')
      setPreviewError(false)
      previewRef.current?.resetPreview()
    }
  }, [urlType, tokenAddress, generateUrl])

  // ---------------------------------------------------------------------------
  // Derived display helpers
  // ---------------------------------------------------------------------------

  const networkName = selectedNetwork ? getNetworkNameFn(selectedNetwork.chainId) : ''

  const showTokenBrowser = urlType === 'token'

  const selectedTokenName = useMemo(() => {
    if (filteredTokens.length === 0) return 'Unknown Token'
    return (
      filteredTokens.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase())?.name ||
      'Unknown Token'
    )
  }, [filteredTokens, tokenAddress])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="loading loading-spinner loading-lg"></div>
          <p>Initializing...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-3xl p-4 sm:p-8">
      <div className="space-y-4 text-center">
        <h1 className="h1">URL Wizard</h1>
        <p className="text-lg">Generate URLs for the Gib Assets API</p>
      </div>

      <div className="card space-y-6">
        {/* API Type Selection */}
        <ApiTypeSelector
          urlType={urlType}
          network={selectedNetwork}
          onSelect={handleApiTypeSelect}
          onLoadTokens={handleApiTypeLoadTokens}
          onGenerate={handleApiTypeGenerate}
          onReset={handleApiTypeReset}
        />

        {/* Token List Selection (only for list type) */}
        {urlType === 'list' && (
          <TokenListSelector
            availableLists={availableLists}
            selectedList={selectedList}
            onSelect={handleListSelect}
          />
        )}

        {/* Network Selection */}
        <NetworkSelect
          isOpenToStart={false}
          network={selectedNetwork}
          onSelect={handleSelectNetwork}
          onNetworkName={handleNetworkName}
        />

        {/* Token Browser (show when network is selected in token mode) */}
        {urlType === 'token' && selectedNetwork && !tokenAddress && (
          <TokenBrowser
            networkName={networkName}
            filteredTokens={filteredTokens}
            isCircularCrop={isCircularCrop}
            currentPage={currentPage}
            tokensPerPage={tokensPerPage}
            onPageChange={setCurrentPage}
            onPerPageUpdate={setTokensPerPage}
            onSelectToken={handleSelectToken}
          >
            <TokenSearch
              count={tokenCount}
              networkName={networkName}
              onSearchUpdate={setCurrentSearchState}
              selectedChain={selectedChain}
              enabledLists={enabledLists}
              tokensByList={tokensByList}
              onToggleList={handleTokenListToggle}
              onToggleAll={handleTokenListToggleAll}
            />
          </TokenBrowser>
        )}

        {/* Manual Token Input */}
        {urlType === 'token' && selectedNetwork && tokenAddress && (
          <TokenAddressInput
            address={tokenAddress}
            onBack={handleTokenAddressBack}
            onInput={handleTokenAddressInput}
          />
        )}

        {/* Generated URL Display */}
        {generatedUrl && (
          <>
            <UrlDisplay url={generatedUrl} />

            {/* Preview */}
            {urlType !== 'list' && previewError && (
              <ErrorMessage
                urlType={urlType as 'token' | 'network'}
                chainId={selectedNetwork?.chainId}
                networkName={getNetworkNameFn(selectedNetwork?.chainId || '')}
                tokenAddress={tokenAddress}
                generatedUrl={generatedUrl}
              />
            )}

            {urlType !== 'list' &&
              !previewError &&
              ((!showTokenBrowser && urlType === 'network') ||
                (urlType === 'token' && tokenAddress)) && (
                <div className="space-y-2">
                  <TokenPreview
                    ref={previewRef}
                    url={generatedUrl}
                    previewError={previewError}
                    iconExists={iconExists}
                    isCircularCrop={isCircularCrop}
                    backgroundColor={backgroundColor}
                    showColorPicker={showColorPicker}
                    setPreviewError={setPreviewError}
                    setIconExists={setIconExists}
                    setIsCircularCrop={setIsCircularCrop}
                    setBackgroundColor={setBackgroundColor}
                    setShowColorPicker={setShowColorPicker}
                  />
                  {filteredTokens.length > 0 && (
                    <div className="text-center text-sm text-surface-600 dark:text-surface-300">
                      {selectedTokenName}
                    </div>
                  )}
                </div>
              )}

            {/* Reset Button */}
            <button
              className="variant-ghost-surface btn w-full"
              type="button"
              onClick={resetForm}
            >
              <i className="fas fa-redo mr-2"></i>
              Reset
            </button>
          </>
        )}
      </div>

      {/* API Documentation Link */}
      <div className="text-center">
        <a href="#/docs" className="variant-ghost-surface btn">
          <i className="fas fa-book mr-2"></i>
          View Full API Documentation
        </a>
      </div>
    </div>
  )
}
