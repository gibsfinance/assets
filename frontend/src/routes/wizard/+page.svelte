<script lang="ts">
  import Icon from '@iconify/svelte'
  import { metrics } from '$lib/stores/metrics'
  import { onMount, onDestroy } from 'svelte'
  import { getApiUrl } from '$lib/utils'
  import type { ApiType, NetworkInfo } from '$lib/types'
  import networkNames from '$lib/networks.json' assert { type: 'json' }
  import Image from '$lib/components/Image.svelte'

  let selectedChain: number | null = null
  let tokenAddress: string = ''
  let urlType: ApiType = 'token'
  let listName: string = 'default'
  let generatedUrl: string = ''
  let copied = false
  let previewError = false
  let showZoomModal = false
  let zoomLevel = 1
  let isDragging = false
  let startX = 0
  let startY = 0
  let translateX = 0
  let translateY = 0
  let iconExists = true
  let showTokenList = false
  let searchQuery = ''
  let isCircularCrop = false
  let backgroundColor = '#151821'
  let showColorPicker = false
  let showTokenBrowser = true
  let availableLists: Array<{
    key: string
    name: string
    providerKey: string
    chainId: string
    type: string
    default: boolean
  }> = []

  let selectedList: { key: string; providerKey: string } | null = null

  let currentPage = 1
  const tokensPerPage = 25
  let allTokens: Token[] = []
  let filteredTokens: Token[] = []

  let isNetworkSelectOpen = false
  let selectedNetwork: NetworkInfo | null = null
  let showTestnets = false

  // Add new state variables for list filtering
  let enabledLists: Set<string> = new Set()
  let tokensByList: Map<string, Token[]> = new Map()
  let isListFilterOpen = false
  let listSearchQuery = ''
  let filteredLists: Array<[string, Token[]]> = []

  // Add cache for token lists and icons
  let tokenListCache: Map<string, Token[]> = new Map()
  let iconStatusCache: Map<string, boolean> = new Map()
  let retryDelay = 100 // Start with 100ms delay
  const maxRetryDelay = 2000 // Max delay of 2 seconds
  const maxRetries = 3

  let isGlobalSearchActive = false
  let globalSearchResults: Token[] = []

  // Add local storage for token lists
  let tokenListsCache = new Map<
    string,
    {
      timestamp: number
      tokens: Token[]
    }
  >()

  const CACHE_DURATION = 1000 * 60 * 60 // 1 hour cache duration

  // Add loading state
  let isSearching = false

  // Add these constants at the top with other constants
  const GITHUB_REPO_URL = 'https://github.com/gibsfinance/assets'
  const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new?template=missing-asset.yml`

  // Add an abort controller before the component logic
  let searchAbortController: AbortController | null = null

  // Add cleanup function
  onDestroy(() => {
    // Cancel any ongoing searches
    if (searchAbortController) {
      searchAbortController.abort()
    }
    // Reset search state
    isSearching = false
    isGlobalSearchActive = false
    globalSearchResults = []
  })

  // Function to get cached list or fetch it
  async function getTokenList(providerKey: string, key: string, chainId: string | number): Promise<Token[]> {
    const cacheKey = `${providerKey}-${key}-${chainId}`
    const now = Date.now()

    // Check cache first
    const cached = tokenListsCache.get(cacheKey)
    if (cached && now - cached.timestamp < CACHE_DURATION) {
      return cached.tokens
    }

    // If not in cache or expired, fetch it
    try {
      const url = getApiUrl(`/list/${providerKey}/${key}?chainId=${chainId}`)
      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json()
        if (data?.tokens && Array.isArray(data.tokens)) {
          const tokens = data.tokens.map((token: Token) => ({
            ...token,
            hasIcon: true,
            sourceList: `${providerKey}/${key}`,
            isBridgeToken: providerKey.includes('bridge'),
            chainName:
              $metrics?.networks.supported.find((n) => n.chainId.toString() === chainId.toString())?.name ||
              `Chain ${chainId}`,
          }))

          // Store in cache
          tokenListsCache.set(cacheKey, {
            timestamp: now,
            tokens,
          })

          return tokens
        }
      }
      return []
    } catch (error) {
      console.error(`Error fetching list ${providerKey}/${key}:`, error)
      return []
    }
  }

  // Load metrics and available lists
  onMount(() => {
    let cancelled = false
    metrics.fetchMetrics()
    fetch(getApiUrl('/list'))
      .then(async (response) => {
        if (cancelled) return
        if (response.ok) {
          const data = await response.json()
          if (cancelled) return
          // Transform the data into the format we need, removing duplicates
          const uniqueLists = new Map()
          data.forEach((info: any) => {
            const key = `${info.providerKey}-${info.key}-${info.chainId}`
            if (!uniqueLists.has(key)) {
              uniqueLists.set(key, {
                key: info.key,
                name: info.name || info.key,
                providerKey: info.providerKey,
                chainId: info.chainId?.toString() || '0',
                type: info.type || 'hosted',
                default: info.default || false,
              })
            }
          })
          availableLists = Array.from(uniqueLists.values())
          console.log('Available lists:', availableLists)
        }
      })
      .catch((error) => {
        console.error('Failed to fetch available lists:', error)
      })

    // Add click outside handler for network select
    const handler = (e: MouseEvent) => {
      if (isNetworkSelectOpen && !(e.target as HTMLElement).closest('.select')) {
        isNetworkSelectOpen = false
      }
    }
    document.addEventListener('click', handler)
    return () => {
      cancelled = true
      document.removeEventListener('click', handler)
    }
  })

  // Add click outside handler for list filter
  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isListFilterOpen && !(e.target as HTMLElement).closest('.list-filter-dropdown')) {
        isListFilterOpen = false
      }
      if (isNetworkSelectOpen && !(e.target as HTMLElement).closest('.select')) {
        isNetworkSelectOpen = false
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  })

  function generateUrl() {
    previewError = false
    iconExists = true

    switch (urlType) {
      case 'network':
        if (selectedChain) {
          generatedUrl = getApiUrl(`/image/${selectedChain}`)
        }
        break
      case 'token':
        if (selectedChain && tokenAddress) {
          generatedUrl = getApiUrl(`/image/${selectedChain}/${tokenAddress}`)
        }
        break
      case 'list':
        if (selectedChain) {
          generatedUrl = getApiUrl(`/list/${listName}?chainId=${selectedChain}`)
        } else {
          generatedUrl = getApiUrl(`/list/${listName}`)
        }
        break
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(generatedUrl)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  function resetForm() {
    selectedChain = null
    tokenAddress = ''
    generatedUrl = ''
    previewError = false
  }

  function handleImageError() {
    previewError = true
    iconExists = false
    generatedUrl = ''
  }

  function handleZoomIn() {
    zoomLevel = Math.min(zoomLevel + 0.5, 4)
  }

  function handleZoomOut() {
    zoomLevel = Math.max(zoomLevel - 0.5, 0.5)
  }

  function handleMouseDown(event: MouseEvent) {
    isDragging = true
    startX = event.clientX - translateX
    startY = event.clientY - translateY
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging) return
    translateX = event.clientX - startX
    translateY = event.clientY - startY
  }

  function handleMouseUp() {
    isDragging = false
  }

  function openZoomModal() {
    showZoomModal = true
    zoomLevel = 1
    translateX = 0
    translateY = 0
  }

  function closeZoomModal() {
    showZoomModal = false
  }

  function getFormattedResponse(url: string) {
    let baseUrl = ''

    if (typeof window !== 'undefined') {
      baseUrl = (window as any).__ipfsPath || ''

      if (window.location.hostname === 'localhost') {
        baseUrl = 'https://gib.show'
      }
    }

    // Ensure the URL starts with the base URL
    if (!url.startsWith('http')) {
      url = `${baseUrl}${url}`
    }

    return [
      `// GET ${url}`,
      '',
      '{',
      '  "name": "Token List",',
      '  "tokens": [',
      '    {',
      '      "chainId": number,',
      '      "address": string,',
      '      "name": string,',
      '      "symbol": string,',
      '      "decimals": number,',
      '      "logoURI": string',
      '    },',
      '    ...',
      '  ]',
      '}',
    ].join('\n')
  }

  function handleWheel(event: WheelEvent) {
    event.preventDefault()

    // Determine zoom direction
    const delta = -Math.sign(event.deltaY)
    const zoomStep = 0.1

    if (delta > 0) {
      // Zoom in
      zoomLevel = Math.min(zoomLevel + zoomStep, 4)
    } else {
      // Zoom out
      zoomLevel = Math.max(zoomLevel - zoomStep, 0.5)
    }
  }

  function toggleTokenListPreview() {
    showTokenList = !showTokenList
  }

  function toggleNetworkSelect() {
    isNetworkSelectOpen = !isNetworkSelectOpen
  }

  function selectNetwork(network: NetworkInfo) {
    selectedChain = network.chainId
    selectedNetwork = network
    isNetworkSelectOpen = false
    generateUrl()

    // When network is selected in token mode, fetch the token list
    if (urlType === 'token') {
      // Try each list in order until we find one that works
      tryFetchTokenLists(network.chainId)
    }
  }

  // Add batch processing helper
  async function processBatch<T, R>(
    items: T[],
    batchSize: number,
    processItem: (item: T) => Promise<R>,
    delayMs: number = 100,
  ): Promise<R[]> {
    const results: R[] = []
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchResults = await Promise.all(batch.map(processItem))
      results.push(...batchResults)
      if (i + batchSize < items.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    return results
  }

  async function processListWithRetry(list: (typeof availableLists)[0], chainId: number) {
    const cacheKey = `${list.providerKey}-${list.key}-${chainId}`

    // Check cache first
    if (tokenListCache.has(cacheKey)) {
      const cachedTokens = tokenListCache.get(cacheKey)!
      const listKey = `${list.providerKey}/${list.key}`
      tokensByList.set(listKey, cachedTokens)
      enabledLists.add(listKey)
      enabledLists = enabledLists // trigger reactivity
      updateCombinedTokenList() // Update the list immediately when cached tokens are added
      return
    }

    let currentRetry = 0
    let currentDelay = retryDelay

    while (currentRetry < maxRetries) {
      try {
        const url = getApiUrl(`/list/${list.providerKey}/${list.key}?chainId=${chainId}`)
        console.log('Fetching list:', url)
        const response = await fetch(url)

        if (response.ok) {
          const data = await response.json()
          if (data?.tokens && Array.isArray(data.tokens)) {
            // Process tokens without checking icons
            const tokens = data.tokens as Token[]
            const processedTokens = tokens.map((token) => ({
              ...token,
              hasIcon: true, // Assume true initially, will be set to false if image fails to load
              sourceList: `${list.providerKey}/${list.key}`,
              isBridgeToken: list.providerKey.includes('bridge'),
            }))

            // Cache the results
            tokenListCache.set(cacheKey, processedTokens)

            // Store tokens by list
            const listKey = `${list.providerKey}/${list.key}`
            tokensByList.set(listKey, processedTokens)
            enabledLists.add(listKey)
            enabledLists = enabledLists // trigger reactivity
            updateCombinedTokenList() // Update the list immediately when new tokens are added
            break
          }
        } else if (response.status === 404) {
          // If list doesn't exist, log it and move on
          console.log(`List ${list.providerKey}/${list.key} not available for chain ${chainId}`)
          break // Don't retry on 404
        } else if (response.status === 429 || response.status === 503) {
          console.warn(`Rate limited while fetching list ${list.name}, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, currentDelay))
          currentDelay = Math.min(currentDelay * 2, maxRetryDelay)
          currentRetry++
          continue
        } else {
          console.warn(`Failed to fetch list ${list.name} with status ${response.status}`)
          break
        }
      } catch (error) {
        console.error(`Failed to fetch list ${list.name}:`, error)
        if (currentRetry < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, currentDelay))
          currentDelay = Math.min(currentDelay * 2, maxRetryDelay)
          currentRetry++
        }
      }
    }
  }

  async function tryFetchTokenLists(chainId: number) {
    // Get relevant lists for the chain
    const relevantLists = availableLists.filter((list) => list.chainId === chainId.toString() || list.chainId === '0')

    console.log('Trying lists for chain', chainId, ':', relevantLists)

    // Clear previous tokens
    tokensByList.clear()
    enabledLists.clear()
    allTokens = []
    filteredTokens = []

    // Sort lists to prioritize non-bridge lists first
    const sortedLists = [...relevantLists].sort((a, b) => {
      const aIsBridge = a.providerKey.includes('bridge')
      const bIsBridge = b.providerKey.includes('bridge')
      return aIsBridge === bIsBridge ? 0 : aIsBridge ? 1 : -1
    })

    // Process lists in parallel but with controlled concurrency
    const processInBatches = async () => {
      const batchSize = 2
      for (let i = 0; i < sortedLists.length; i += batchSize) {
        const batch = sortedLists.slice(i, i + batchSize)
        await Promise.all(batch.map((list) => processListWithRetry(list, chainId)))
      }
    }

    // Start processing in the background
    processInBatches()
  }

  // Function to update the combined token list based on enabled lists
  function updateCombinedTokenList() {
    // Create a Map to deduplicate tokens by address
    const tokenMap = new Map<string, Token>()

    // First add non-bridge tokens
    for (const [listKey, tokens] of tokensByList.entries()) {
      if (enabledLists.has(listKey) && !listKey.includes('bridge')) {
        for (const token of tokens) {
          const key = `${token.chainId}-${token.address.toLowerCase()}`
          if (!tokenMap.has(key) && token.hasIcon) {
            // Only add if it has an icon
            tokenMap.set(key, token)
          }
        }
      }
    }

    // Then add bridge tokens only if they don't already exist
    for (const [listKey, tokens] of tokensByList.entries()) {
      if (enabledLists.has(listKey) && listKey.includes('bridge')) {
        for (const token of tokens) {
          const key = `${token.chainId}-${token.address.toLowerCase()}`
          // Only add bridge token if:
          // 1. Token doesn't exist yet
          // 2. Token has a verified icon
          if (!tokenMap.has(key) && token.hasIcon) {
            tokenMap.set(key, token)
          }
        }
      }
    }

    // Convert Map to array and filter out any tokens that have lost their icons
    allTokens = Array.from(tokenMap.values()).filter((token) => token.hasIcon)
    filteredTokens = allTokens
    currentPage = 1
  }

  // Function to toggle a list
  function toggleList(listKey: string) {
    if (enabledLists.has(listKey)) {
      enabledLists.delete(listKey)
    } else {
      enabledLists.add(listKey)
    }
    enabledLists = enabledLists // trigger reactivity
    updateCombinedTokenList()
  }

  interface Token {
    chainId: number
    address: string
    name: string
    symbol: string
    decimals: number
    logoURI: string
    hasIcon?: boolean
    sourceList: string
    isBridgeToken: boolean
    chainName?: string
  }

  function getTokenUrl(token: Token): string {
    return getApiUrl(`/image/${token.chainId}/${token.address}`)
  }

  function handleColorInput(event: Event) {
    const input = event.target as HTMLInputElement
    backgroundColor = input.value
  }

  function handleColorTextInput(event: Event) {
    const input = event.target as HTMLInputElement
    const value = input.value.trim()
    // Support various color formats
    if (value.match(/^#[0-9A-Fa-f]{6}$/)) {
      backgroundColor = value
    } else if (value.match(/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/)) {
      backgroundColor = value
    } else if (value.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/)) {
      backgroundColor = value
    }
  }

  // Modify the performGlobalSearch function to use the abort controller
  async function performGlobalSearch() {
    // Cancel any previous ongoing search
    if (searchAbortController) {
      searchAbortController.abort()
    }
    // Create new abort controller for this search
    searchAbortController = new AbortController()

    isGlobalSearchActive = true
    isSearching = true
    globalSearchResults = []
    filteredTokens = [] // Clear current results while searching
    currentPage = 1
    const searchTerm = searchQuery.toLowerCase()

    try {
      // Split lists into global and chain-specific
      const globalLists = availableLists.filter((list) => list.chainId === '0')
      const chainSpecificLists = availableLists.filter((list) => list.chainId !== '0')

      console.log('Starting global search')

      // First, fetch all global lists (these contain tokens for all chains)
      for (const list of globalLists) {
        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          console.log('Fetching global list:', url)
          const response = await fetch(url, {
            signal: searchAbortController.signal,
          })

          if (response.ok) {
            const data = await response.json()
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
                    $metrics?.networks.supported.find((n) => n.chainId.toString() === token.chainId.toString())?.name ||
                    `Chain ${token.chainId}`,
                }))

              if (matchingTokens.length > 0) {
                globalSearchResults = [...globalSearchResults, ...matchingTokens]
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('Search aborted')
            return // Exit early if search was aborted
          }
          console.error(`Error searching global list ${list.providerKey}/${list.key}:`, error)
        }
      }

      // Then, fetch chain-specific lists
      for (const list of chainSpecificLists) {
        try {
          const url = getApiUrl(`/list/${list.providerKey}/${list.key}`)
          console.log('Fetching chain-specific list:', url)
          const response = await fetch(url, {
            signal: searchAbortController.signal,
          })

          if (response.ok) {
            const data = await response.json()
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
                    $metrics?.networks.supported.find((n) => n.chainId.toString() === token.chainId.toString())?.name ||
                    `Chain ${token.chainId}`,
                }))

              if (matchingTokens.length > 0) {
                globalSearchResults = [...globalSearchResults, ...matchingTokens]
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('Search aborted')
            return // Exit early if search was aborted
          }
          console.error(`Error searching chain-specific list ${list.providerKey}/${list.key}:`, error)
        }
      }

      // Only process results if search wasn't aborted
      if (!searchAbortController.signal.aborted) {
        // Remove duplicates
        globalSearchResults = Array.from(
          new Map(
            globalSearchResults.map((token) => [`${token.chainId}-${token.address.toLowerCase()}`, token]),
          ).values(),
        )

        // Sort results
        globalSearchResults.sort((a, b) => {
          // Ethereum chain first
          if (a.chainId.toString() === '1' && b.chainId.toString() !== '1') return -1
          if (a.chainId.toString() !== '1' && b.chainId.toString() === '1') return 1
          // Then by name
          return a.name.localeCompare(b.name)
        })

        // Update filteredTokens with the global search results
        filteredTokens = globalSearchResults
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Global search error:', error)
      }
    } finally {
      if (searchAbortController?.signal.aborted) {
        // Reset everything if search was aborted
        globalSearchResults = []
        filteredTokens = allTokens.filter((token) => token.chainId.toString() === selectedChain?.toString())
      }
      isSearching = false
    }
  }

  function getNetworkName(chainId: number | string): string {
    const chainIdStr = chainId.toString()
    // First check our priority networks to ensure specific naming
    const priorityNames: Record<string, string> = {
      '1': 'Ethereum',
      '369': 'PulseChain',
      '56': 'BNB Smart Chain',
      '137': 'Polygon',
      '42161': 'Arbitrum One',
      '10': 'Optimism',
      '100': 'Gnosis Chain',
      '324': 'zkSync Era',
      '534352': 'Scroll',
      '250': 'Fantom Opera',
      '1030': 'Conflux eSpace',
      '5000': 'Mantle',
      '8453': 'Base',
      '59144': 'Linea',
      '7777777': 'Zora',
    }

    // Use priority names first, then fall back to Uniswap names, then to generic Chain ID
    const networkName = priorityNames[chainIdStr] || networkNames[chainIdStr as keyof typeof networkNames]
    return networkName || `Chain ${chainIdStr}`
  }

  // Sort networks by priority and name
  function sortNetworks(networks: NetworkInfo[]): NetworkInfo[] {
    const priorityChains = ['1', '369'] // Ethereum and PulseChain first

    // Filter out testnets if showTestnets is false
    let filteredNetworks = networks
    if (!showTestnets) {
      filteredNetworks = networks.filter(
        (network) => !getNetworkName(network.chainId).toLowerCase().includes('testnet'),
      )
    }

    return [...filteredNetworks].sort((a, b) => {
      const aChainId = a.chainId.toString()
      const bChainId = b.chainId.toString()

      // Priority chains first
      const aIndex = priorityChains.indexOf(aChainId)
      const bIndex = priorityChains.indexOf(bChainId)

      if (aIndex !== -1 && bIndex === -1) return -1
      if (aIndex === -1 && bIndex !== -1) return 1
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex

      // Then sort by name
      return getNetworkName(a.chainId).localeCompare(getNetworkName(b.chainId))
    })
  }

  function createGithubIssue() {
    const isToken = urlType === 'token'
    const params = new URLSearchParams({
      'labels[]': 'missing-asset',
      template: 'missing-asset.yml',
      'asset-type': isToken ? 'Token Icon' : 'Network Icon',
      'network-name': getNetworkName(selectedChain || 0),
      'chain-id': selectedChain?.toString() || '',
      'token-address': isToken ? tokenAddress : '',
      'attempted-url': generatedUrl,
      title: isToken
        ? `Missing Token Icon: ${getNetworkName(selectedChain || 0)} - ${tokenAddress}`
        : `Missing Network Icon: ${getNetworkName(selectedChain || 0)} (Chain ID: ${selectedChain})`,
    })
    window.open(`${GITHUB_REPO_URL}/issues/new?${params.toString()}`, '_blank')
  }

  function filterTokens() {
    const searchTerm = searchQuery.toLowerCase()

    if (!isGlobalSearchActive) {
      // Filter only tokens from the selected chain
      filteredTokens = allTokens.filter(
        (token) =>
          token.chainId.toString() === selectedChain?.toString() &&
          (token.name.toLowerCase().includes(searchTerm) ||
            token.symbol.toLowerCase().includes(searchTerm) ||
            token.address.toLowerCase().includes(searchTerm)),
      )
    } else {
      // Use global search results
      filteredTokens = globalSearchResults
    }

    currentPage = 1
  }

  // Update the search query watcher
  $: {
    if (searchQuery) {
      if (!isGlobalSearchActive) {
        filterTokens()
      }
    } else {
      // Reset to show all tokens for the selected chain when search is cleared
      isGlobalSearchActive = false
      filteredTokens = allTokens.filter((token) => token.chainId.toString() === selectedChain?.toString())
      globalSearchResults = []
      currentPage = 1
    }
  }

  // Add a watcher for selectedChain changes
  $: {
    if (selectedChain && !isGlobalSearchActive) {
      filteredTokens = allTokens.filter((token) => token.chainId.toString() === selectedChain?.toString())
      if (searchQuery) {
        filterTokens()
      }
      currentPage = 1
    }
  }
</script>

<div class="container mx-auto p-4 sm:p-8 max-w-3xl space-y-8">
  <div class="text-center space-y-4">
    <h1 class="h1">URL Wizard</h1>
    <p class="text-lg">Generate URLs for the Gib Assets API</p>
  </div>

  <div class="card p-4 sm:p-6 space-y-6">
    <!-- API Type Selection -->
    <div class="space-y-2">
      <span class="label">What are you looking for?</span>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <button
          class="btn {urlType === 'token' ? 'variant-filled-primary' : 'variant-ghost'}"
          on:click={() => {
            urlType = 'token'
            generatedUrl = ''
            previewError = false
            showTokenBrowser = true
            // Reset token selection
            tokenAddress = ''
            allTokens = []
            filteredTokens = []
          }}>
          <i class="fas fa-coins mr-2"></i>
          Token Icon
        </button>
        <button
          class="btn {urlType === 'network' ? 'variant-filled-primary' : 'variant-ghost'}"
          on:click={() => {
            urlType = 'network'
            generatedUrl = ''
            tokenAddress = ''
            previewError = false
            showTokenBrowser = false
            // Clear token lists
            allTokens = []
            filteredTokens = []
          }}>
          <i class="fas fa-network-wired mr-2"></i>
          Network Icon
        </button>
      </div>
    </div>

    <!-- Token List Selection (only for list type) -->
    {#if urlType === 'list'}
      <div class="space-y-2">
        <label for="list-select" class="label">Select Token List</label>
        <select
          id="list-select"
          class="select"
          bind:value={selectedList}
          on:change={(e) => {
            if (selectedList) {
              listName = `${selectedList.providerKey}/${selectedList.key}`
              generateUrl()
            }
          }}>
          <option value={null}>Choose a list...</option>
          {#each availableLists as list}
            <option value={{ key: list.key, providerKey: list.providerKey }}>
              {list.name} ({list.providerKey}/{list.key})
            </option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- Network Selection -->
    <div class="space-y-2">
      <div class="relative w-full">
        <div class="flex justify-between items-center mb-2">
          <label class="label">
            <span class="leading-5">Select Network</span>
          </label>
          <label class="flex items-center space-x-2">
            <span class="text-sm">Show Testnets</span>
            <input type="checkbox" class="checkbox" bind:checked={showTestnets} />
          </label>
        </div>
        <button
          type="button"
          class="select w-full text-left flex justify-between items-center py-2 px-3 text-sm leading-6"
          on:click={toggleNetworkSelect}>
          {#if selectedNetwork}
            <span class="truncate"
              >{getNetworkName(selectedNetwork.chainId)} (Chain ID: {selectedNetwork.chainId})</span>
          {:else}
            <span class="text-gray-500">Choose a network...</span>
          {/if}
          <i class="fas fa-chevron-down transition-transform flex-shrink-0 ml-2" class:rotate-180={isNetworkSelectOpen}
          ></i>
        </button>

        {#if isNetworkSelectOpen}
          <div
            class="absolute z-50 w-full mt-1 bg-white dark:bg-[#202633] border border-gray-200 dark:border-surface-700/20 shadow-lg max-h-[300px] overflow-y-auto text-sm rounded-container-token">
            {#if $metrics}
              {#each sortNetworks($metrics.networks.supported) as network}
                <button
                  class="w-full px-3 py-1.5 text-left hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20 transition-colors flex items-center justify-between"
                  class:selected={selectedChain === network.chainId}
                  on:click={() => selectNetwork(network)}>
                  <span class="truncate mr-2">{getNetworkName(network.chainId)}</span>
                  <span class="text-surface-500 whitespace-nowrap flex-shrink-0">(Chain ID: {network.chainId})</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- Token Browser (show when network is selected in token mode) -->
    {#if urlType === 'token' && selectedNetwork && !tokenAddress}
      <div class="card variant-ghost p-1 sm:p-2 space-y-2">
        <div class="space-y-2">
          <!-- Chain Token Count Header -->
          <div class="flex items-center justify-between">
            <span class="font-medium">
              {filteredTokens.length}
              {filteredTokens.length === 1 ? 'token' : 'tokens'} on {getNetworkName(selectedNetwork.chainId)}
            </span>
          </div>

          <!-- Search and Filter -->
          <div class="flex gap-1">
            <div class="input-group input-group-divider grid-cols-[auto_1fr_auto_auto] rounded-container-token flex-1">
              <div class="input-group-shim">
                <i class="fas fa-search"></i>
              </div>
              <input
                type="search"
                placeholder="Search tokens..."
                class="input"
                bind:value={searchQuery}
                on:input={(e) => {
                  if (!isGlobalSearchActive) {
                    currentPage = 1
                    filterTokens()
                  }
                }} />
              <button
                class="input-group-shim btn variant-soft-primary"
                on:click={() => {
                  isGlobalSearchActive = true
                  performGlobalSearch()
                }}
                disabled={!searchQuery}>
                <i class="fas fa-globe mr-2"></i>
                Search All Chains
              </button>
            </div>

            <!-- List filter dropdown -->
            <div class="relative">
              <button
                class="btn variant-soft-surface list-filter-dropdown"
                on:click={() => {
                  isListFilterOpen = !isListFilterOpen
                  if (isListFilterOpen) {
                    listSearchQuery = ''
                    // Filter out lists with 0 tokens
                    filteredLists = Array.from(tokensByList.entries()).filter(([_, tokens]) => tokens.length > 0)
                  }
                }}>
                <i class="fas fa-filter mr-2"></i>
                Lists ({enabledLists.size})
              </button>

              {#if isListFilterOpen}
                <div class="absolute right-0 mt-1 w-64 bg-surface-100-800-token card p-2 z-50 list-filter-dropdown">
                  <div class="p-2 space-y-3">
                    <div class="flex justify-between items-center">
                      <h3 class="h4">Token Lists</h3>
                      <button
                        class="btn btn-sm variant-soft"
                        on:click={() => {
                          const allEnabled = filteredLists.every(([key]) => enabledLists.has(key))
                          if (allEnabled) {
                            // Disable all lists
                            filteredLists.forEach(([key]) => enabledLists.delete(key))
                          } else {
                            // Enable all lists
                            filteredLists.forEach(([key]) => enabledLists.add(key))
                          }
                          enabledLists = enabledLists // trigger reactivity
                          updateCombinedTokenList()
                        }}>
                        <i class="fas fa-check-double mr-2"></i>
                        Toggle All
                      </button>
                    </div>
                    <!-- Add search input -->
                    <div class="input-group input-group-divider grid-cols-[auto_1fr_auto] rounded-container-token">
                      <div class="input-group-shim">
                        <i class="fas fa-search"></i>
                      </div>
                      <input
                        type="search"
                        placeholder="Search lists..."
                        class="input"
                        bind:value={listSearchQuery}
                        on:input={(e) => {
                          // Filter lists based on search and exclude empty lists
                          filteredLists = Array.from(tokensByList.entries()).filter(
                            ([key, tokens]) =>
                              tokens.length > 0 && // Only include lists with tokens
                              (!listSearchQuery || key.toLowerCase().includes(listSearchQuery.toLowerCase())),
                          )
                        }} />
                    </div>
                    <!-- List container with fixed height -->
                    <div class="overflow-y-auto" style="height: 297px">
                      <!-- Height for ~8.5 items (35px per item) -->
                      {#each filteredLists as [listKey, tokens]}
                        <label class="flex items-center gap-2 p-2 hover:bg-surface-hover cursor-pointer">
                          <input
                            type="checkbox"
                            class="checkbox"
                            checked={enabledLists.has(listKey)}
                            on:change={(e) => {
                              const checkbox = e.target as HTMLInputElement
                              if (checkbox.checked) {
                                enabledLists.add(listKey)
                              } else {
                                enabledLists.delete(listKey)
                              }
                              enabledLists = enabledLists // trigger reactivity
                              updateCombinedTokenList()
                            }} />
                          <div class="flex-1">
                            <div class="font-medium">{listKey}</div>
                            <div class="text-xs opacity-75">{tokens.length} tokens</div>
                          </div>
                        </label>
                      {/each}
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          </div>

          {#if filteredTokens.length === 0 && !isSearching}
            <div class="text-center p-4 text-gray-500">
              {searchQuery ? 'No tokens match your search' : 'Loading tokens...'}
            </div>
          {:else if isSearching}
            <div class="text-center p-4">
              <div class="spinner" />
              <p class="mt-2 text-gray-500">Searching across all chains...</p>
            </div>
          {:else}
            <!-- Token Table -->
            <div class="table-container">
              <table class="token-table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Symbol</th>
                    <th>Address</th>
                    <th>Network</th>
                  </tr>
                </thead>
                <tbody>
                  {#each (isGlobalSearchActive ? globalSearchResults : filteredTokens).slice((currentPage - 1) * tokensPerPage, currentPage * tokensPerPage) as token}
                    <tr
                      class="cursor-pointer hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20 transition-colors"
                      on:click={() => {
                        if (isGlobalSearchActive) {
                          const network = $metrics?.networks.supported.find((n) => n.chainId === token.chainId)
                          if (network) {
                            selectNetwork(network)
                          }
                        }
                        tokenAddress = token.address
                        generateUrl()
                      }}>
                      <td class="p-1">
                        <div class="flex items-center gap-2">
                          <div
                            class="min-w-[40px] min-h-[40px] w-10 h-10 relative flex items-center justify-center bg-surface-700 {isCircularCrop
                              ? 'rounded-full'
                              : ''}">
                            {#snippet imageFallback()}
                              <Icon icon="nrk:404" class="w-12 h-12" />
                            {/snippet}
                            {#if token.hasIcon}
                              <Image
                                src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                                alt={token.symbol}
                                class="object-contain user-drag-none {isCircularCrop ? 'rounded-full' : ''}"
                                size={32}
                                onerror={() => {
                                  token.hasIcon = false
                                  if (!isGlobalSearchActive) {
                                    // Only update combined list for normal search
                                    updateCombinedTokenList()
                                  }
                                }}>
                                {#snippet fallback()}
                                  {@render imageFallback()}
                                {/snippet}
                              </Image>
                            {:else}
                              {@render imageFallback()}
                            {/if}
                          </div>
                          <div class="flex flex-col">
                            <span class="font-medium">{token.name}</span>
                            <div class="flex gap-2 items-center">
                              {#if !token.hasIcon}
                                <span class="text-xs text-error-500">No icon</span>
                              {/if}
                              <span class="text-xs opacity-75">{token.sourceList}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td title={token.symbol}>{token.symbol}</td>
                      <td title={token.address}>
                        <code class="text-xs">{token.address}</code>
                      </td>
                      <td title={getNetworkName(token.chainId)}>
                        <span class="text-sm">{getNetworkName(token.chainId)}</span>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- Pagination -->
            <div class="flex justify-between items-center">
              <button class="btn btn-sm variant-soft" disabled={currentPage === 1} on:click={() => currentPage--}>
                <i class="fas fa-chevron-left mr-2"></i>
                Previous
              </button>
              <span class="text-sm">
                Page {currentPage} of {Math.ceil(
                  (isGlobalSearchActive ? globalSearchResults : filteredTokens).length / tokensPerPage,
                )}
              </span>
              <button
                class="btn btn-sm variant-soft"
                disabled={currentPage >=
                  Math.ceil((isGlobalSearchActive ? globalSearchResults : filteredTokens).length / tokensPerPage)}
                on:click={() => currentPage++}>
                Next
                <i class="fas fa-chevron-right ml-2"></i>
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Manual Token Input (show when token browser is hidden or token is selected) -->
    {#if urlType === 'token' && selectedNetwork && tokenAddress}
      <div class="space-y-2">
        <div class="flex justify-between items-center">
          <label for="token-address" class="label">Token Address</label>
          <button
            class="btn btn-sm variant-soft"
            on:click={() => {
              tokenAddress = ''
              generatedUrl = ''
            }}>
            <i class="fas fa-list mr-2"></i>
            Browse Tokens
          </button>
        </div>
        <input
          id="token-address"
          type="text"
          class="input"
          placeholder="0x..."
          bind:value={tokenAddress}
          on:input={(e) => {
            const input = e.target as HTMLInputElement
            tokenAddress = input.value.trim()
            generateUrl()
          }} />
      </div>
    {/if}

    <!-- After the token address input and before the Generated URL Display -->
    {#if urlType !== 'list' && previewError}
      <div class="card variant-ghost-error p-4">
        <div class="flex items-center gap-3">
          <i class="fas fa-exclamation-circle text-error-500"></i>
          <div class="flex-1">
            <p class="font-medium">No icon found</p>
            <p class="text-sm opacity-90">
              There is no {urlType === 'token' ? 'token' : 'network'} icon available for this address yet. You can help by
              <a href="#" class="anchor" on:click|preventDefault={createGithubIssue}>submitting an issue</a> or
              contributing directly to the
              <a href={GITHUB_REPO_URL} class="anchor" target="_blank" rel="noopener">Gib Assets repository</a>.
            </p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Generated URL Display (only show if URL exists and icon is found for image types) -->
    {#if generatedUrl && (urlType === 'list' || iconExists)}
      <div class="card variant-ghost p-4 space-y-2">
        <div class="flex justify-between items-center">
          <span class="label">Generated URL</span>
          <button class="btn btn-sm variant-soft" on:click={copyToClipboard}>
            {#if copied}
              <i class="fas fa-check mr-2"></i>
              Copied!
            {:else}
              <i class="fas fa-copy mr-2"></i>
              Copy
            {/if}
          </button>
        </div>
        <code class="text-sm break-all">{generatedUrl}</code>
      </div>

      <!-- Preview (only for token and network icons) -->
      {#if urlType !== 'list' && ((!showTokenBrowser && urlType === 'network') || (urlType === 'token' && tokenAddress))}
        <div class="card variant-ghost p-4 space-y-2">
          <div class="flex justify-between items-center">
            <span class="label">Preview</span>
            <div class="flex gap-2">
              <button class="btn btn-sm variant-soft-surface" on:click={handleZoomOut} disabled={zoomLevel <= 0.5}>
                <i class="fas fa-minus"></i>
              </button>
              <span class="flex items-center px-2 text-sm">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button class="btn btn-sm variant-soft-surface" on:click={handleZoomIn} disabled={zoomLevel >= 4}>
                <i class="fas fa-plus"></i>
              </button>
            </div>
          </div>
          <div class="flex flex-col justify-center">
            {#if previewError}
              <div class="text-error-500 flex items-center gap-2">
                <i class="fas fa-exclamation-circle"></i>
                <span>No icon found for this {urlType === 'token' ? 'token' : 'network'} yet.</span>
              </div>
            {:else}
              <div
                class="overflow-hidden relative h-[300px] w-full cursor-move {showColorPicker
                  ? ''
                  : 'checkerboard'} border border-surface-700/20"
                style="background-color: {showColorPicker ? backgroundColor : ''}"
                on:mousedown={handleMouseDown}
                on:mousemove={handleMouseMove}
                on:mouseup={handleMouseUp}
                on:mouseleave={handleMouseUp}
                on:wheel={(e) => {
                  e.preventDefault()
                  return handleWheel(e)
                }}>
                <Image
                  alt="Icon preview"
                  src={generatedUrl.replace(/^\./, 'https://gib.show')}
                  class="absolute user-drag-none left-1/2 top-1/2 transition-transform duration-100 {isCircularCrop
                    ? 'rounded-full'
                    : ''}"
                  style="transform: translate(calc(-50% + {translateX}px), calc(-50% + {translateY}px)) scale({zoomLevel})"
                  size={128}
                  onerror={handleImageError} />
                <!-- <img
                  src={generatedUrl.replace(/^\./, 'https://gib.show')}
                  alt="Icon preview"
                  class="absolute left-1/2 top-1/2 transition-transform duration-100 {isCircularCrop
                    ? 'rounded-full'
                    : ''}"
                  style="transform: translate(calc(-50% + {translateX}px), calc(-50% + {translateY}px)) scale({zoomLevel})"
                  height={128}
                  width={128}
                  on:error={handleImageError} /> -->
              </div>
              <div class="text-center text-sm text-gray-400 mt-2">
                <span class="opacity-75">Click and drag to pan • Scroll to zoom</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Preview Options -->
        <div class="card variant-ghost p-4 space-y-4">
          <span class="label">Preview Options</span>
          <div class="flex flex-col gap-4">
            <!-- Crop Option -->
            <label class="flex items-center gap-2">
              <input type="checkbox" class="checkbox" bind:checked={isCircularCrop} />
              <span>Circular Crop</span>
            </label>

            <!-- Background Options -->
            <div class="space-y-2">
              <label class="flex items-center gap-2">
                <input type="checkbox" class="checkbox" bind:checked={showColorPicker} />
                <span>Custom Background Color</span>
              </label>

              {#if showColorPicker}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Color Picker -->
                  <div class="space-y-2">
                    <label class="text-sm">Pick a color:</label>
                    <input
                      type="color"
                      class="w-full h-10 rounded cursor-pointer"
                      value={backgroundColor}
                      on:input={handleColorInput} />
                  </div>

                  <!-- Color Input -->
                  <div class="space-y-2">
                    <label class="text-sm">Or enter a color value:</label>
                    <input
                      type="text"
                      class="input"
                      placeholder="#HEX, rgb(), rgba()"
                      value={backgroundColor}
                      on:input={handleColorTextInput} />
                    <p class="text-xs opacity-75">
                      Supports HEX (#RRGGBB), RGB (rgb(r,g,b)), and RGBA (rgba(r,g,b,a))
                    </p>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Reset Button -->
      <button class="btn variant-ghost-surface w-full" on:click={resetForm}>
        <i class="fas fa-redo mr-2"></i>
        Reset
      </button>
    {/if}
  </div>

  <!-- API Documentation Link -->
  <div class="text-center">
    <a href="/docs" class="btn variant-ghost-surface">
      <i class="fas fa-book mr-2"></i>
      View Full API Documentation
    </a>
  </div>
</div>

<style lang="postcss">
  .label {
    @apply font-medium text-sm;
  }
  /*.input,
  .select {
    @apply w-full;
  }*/
  /* Prevent image dragging which interferes with pan functionality */
  :global(.user-drag-none) {
    -webkit-user-drag: none;
    user-select: none;
    -moz-user-select: none;
    -webkit-user-select: none;
    -ms-user-select: none;
  }

  /* Response Preview Syntax Highlighting */
  pre code {
    @apply font-mono;
  }

  pre code :global(.comment) {
    @apply text-surface-500;
  }

  pre code :global(.string) {
    @apply text-primary-500;
  }

  pre code :global(.type) {
    @apply text-secondary-500;
  }

  /* Checkerboard pattern for transparent image background */
  .checkerboard {
    background-color: #fff;
    background-image: linear-gradient(45deg, #ddd 25%, transparent 25%),
      linear-gradient(-45deg, #ddd 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ddd 75%),
      linear-gradient(-45deg, transparent 75%, #ddd 75%);
    background-size: 16px 16px; /* Reduced from 20px to 16px for a tighter pattern */
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0px;
  }

  /* Dark mode version - using more subtle colors */
  :global(.dark) .checkerboard {
    background-color: #1a1a1a;
    background-image: linear-gradient(45deg, #252525 25%, transparent 25%),
      linear-gradient(-45deg, #252525 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252525 75%),
      linear-gradient(-45deg, transparent 75%, #252525 75%);
  }

  /* Add smooth transitions */
  .select {
    @apply transition-all duration-200;
  }

  /* Custom scrollbar for the dropdown */
  .overflow-y-auto {
    scrollbar-width: thin;
    scrollbar-color: #00dc82 transparent;
  }

  .overflow-y-auto::-webkit-scrollbar {
    width: 4px;
  }

  .overflow-y-auto::-webkit-scrollbar-track {
    @apply bg-transparent;
  }

  .overflow-y-auto::-webkit-scrollbar-thumb {
    @apply bg-[#00DC82]/50 rounded-full;
  }

  .selected {
    @apply bg-[#00DC82]/20;
  }

  .spinner {
    @apply w-8 h-8 border-4 border-primary-500/20 border-t-primary-500 rounded-full mx-auto;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .token-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
  }

  .token-table th,
  .token-table td {
    padding: 0.5rem;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .token-table th:nth-child(1),
  .token-table td:nth-child(1) {
    width: 35%;
  }

  .token-table th:nth-child(2),
  .token-table td:nth-child(2) {
    width: 15%;
  }

  .token-table th:nth-child(3),
  .token-table td:nth-child(3) {
    width: 35%;
  }

  .token-table th:nth-child(4),
  .token-table td:nth-child(4) {
    width: 15%;
  }

  /* Add styles for the address code element */
  .token-table td code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  /* Add container styles to ensure proper scrolling */
  .table-container {
    width: 100%;
    overflow-x: auto;
    margin: 1rem 0;
  }

  .spinner-small {
    @apply w-4 h-4 border-2 border-surface-50/20 border-t-surface-50 rounded-full;
    animation: spin 1s linear infinite;
  }
</style>
