<script lang="ts">
  import { metrics } from '$lib/stores/metrics'
  import { onMount } from 'svelte'
  import { getApiUrl } from '$lib/utils'
  import type { ApiType, NetworkInfo } from '$lib/types'
  import NetworkSelect from '$lib/components/NetworkSelect.svelte'
  import TokenPreview from '$lib/components/TokenPreview.svelte'
  import ErrorMessage from '$lib/components/ErrorMessage.svelte'
  import ApiTypeSelector from '$lib/components/ApiTypeSelector.svelte'
  import UrlDisplay from '$lib/components/UrlDisplay.svelte'
  import TokenAddressInput from '$lib/components/TokenAddressInput.svelte'
  import TokenListSelector from '$lib/components/TokenListSelector.svelte'
  import TokenBrowser from '$lib/components/TokenBrowser.svelte'

  let getNetworkName: (chainId: number | string) => string
  let selectedChain: number | null = null
  let tokenAddress: string = ''
  let urlType: ApiType = 'token'
  let listName: string = 'default'
  let generatedUrl: string = ''
  let previewError = false
  let iconExists = true
  let isCircularCrop = false
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
  let selectedNetwork: NetworkInfo | null = null
  let showTestnets = false
  let isNetworkSelectOpen = false

  // TokenBrowser state
  let filteredTokens: any[] = []
  let enabledLists = new Set<string>()
  let tokensByList = new Map<string, any[]>()
  let isListFilterOpen = false
  let searchQuery = ''
  let isGlobalSearchActive = false
  let isSearching = false
  let globalSearchResults: any[] = []
  let currentPage = 1
  let tokensPerPage = 25
  let backgroundColor = '#151821'
  let showColorPicker = false

  // Add missing state
  let allTokens: any[] = []

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
        }
      })
      .catch((error) => {
        console.error('Failed to fetch available lists:', error)
      })

    return () => {
      cancelled = true
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

  function resetForm() {
    selectedChain = null
    tokenAddress = ''
    generatedUrl = ''
    previewError = false
  }

  function selectNetwork(network: NetworkInfo) {
    selectedChain = network.chainId
    selectedNetwork = network
    generateUrl()
    // Fetch token lists when in token mode
    if (urlType === 'token') {
      tryFetchTokenLists(network.chainId)
    }
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
  }

  function handleTokenListToggle(event: CustomEvent<{ listKey: string; enabled: boolean }>) {
    const { listKey, enabled } = event.detail
    if (enabled) {
      enabledLists.add(listKey)
    } else {
      enabledLists.delete(listKey)
    }
    enabledLists = enabledLists // trigger reactivity
    updateCombinedTokenList()
  }

  function handleTokenListToggleAll(event: CustomEvent<{ enabled: boolean }>) {
    const { enabled } = event.detail
    const listsToToggle = Array.from(tokensByList.entries())
      .filter(([_, tokens]) => tokens.length > 0)
      .map(([key]) => key)

    if (enabled) {
      listsToToggle.forEach(key => enabledLists.add(key))
    } else {
      listsToToggle.forEach(key => enabledLists.delete(key))
    }
    enabledLists = enabledLists // trigger reactivity
    updateCombinedTokenList()
  }

  async function tryFetchTokenLists(chainId: number) {
    // Get relevant lists for the chain
    const relevantLists = availableLists.filter((list) => list.chainId === chainId.toString() || list.chainId === '0')

    // Clear previous tokens
    tokensByList.clear()
    enabledLists.clear()
    allTokens = []
    filteredTokens = []

    // Process lists in parallel but with controlled concurrency
    const processInBatches = async () => {
      const batchSize = 2
      for (let i = 0; i < relevantLists.length; i += batchSize) {
        const batch = relevantLists.slice(i, i + batchSize)
        await Promise.all(batch.map((list) => processListWithRetry(list, chainId)))
      }
    }

    // Start processing in the background
    processInBatches()
  }

  function updateCombinedTokenList() {
    // Create a Map to deduplicate tokens by address
    const tokenMap = new Map<string, any>()

    // First add non-bridge tokens
    for (const [listKey, tokens] of tokensByList.entries()) {
      if (enabledLists.has(listKey) && !listKey.includes('bridge')) {
        for (const token of tokens) {
          const key = `${token.chainId}-${token.address.toLowerCase()}`
          if (!tokenMap.has(key) && token.hasIcon) {
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
          if (!tokenMap.has(key) && token.hasIcon) {
            tokenMap.set(key, token)
          }
        }
      }
    }

    allTokens = Array.from(tokenMap.values())
    filteredTokens = allTokens.filter((token) => token.chainId.toString() === selectedChain?.toString())
    currentPage = 1
  }

  async function processListWithRetry(list: (typeof availableLists)[0], chainId: number) {
    try {
      // Add chainId parameter for chain-specific lists
      const url = list.chainId === '0' 
        ? getApiUrl(`/list/${list.providerKey}/${list.key}`)
        : getApiUrl(`/list/${list.providerKey}/${list.key}?chainId=${chainId}`)
      const response = await fetch(url)

      if (response.ok) {
        const data = await response.json()
        if (data?.tokens && Array.isArray(data.tokens)) {
          const tokens = data.tokens.map((token: any) => ({
            ...token,
            hasIcon: true,
            sourceList: `${list.providerKey}/${list.key}`,
            isBridgeToken: list.providerKey.includes('bridge'),
          }))

          const listKey = `${list.providerKey}/${list.key}`
          tokensByList.set(listKey, tokens)
          enabledLists.add(listKey)
          enabledLists = enabledLists // trigger reactivity
          tokensByList = tokensByList // trigger reactivity
          updateCombinedTokenList()
        }
      } else if (response.status === 404) {
        console.log(`List ${list.providerKey}/${list.key} not available for chain ${chainId}`)
      }
    } catch (error) {
      console.error(`Failed to fetch list ${list.name}:`, error)
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
    <ApiTypeSelector
      bind:urlType
      on:select={() => {
        generatedUrl = ''
        previewError = false
        showTokenBrowser = urlType === 'token'
        // Reset token selection
        tokenAddress = ''
        // If we have a selected network, reload its tokens
        if (selectedNetwork && urlType === 'token') {
          tryFetchTokenLists(selectedNetwork.chainId)
        }
      }}
      on:reset={() => {
        generatedUrl = ''
        tokenAddress = ''
        previewError = false
      }}
    />

    <!-- Token List Selection (only for list type) -->
    {#if urlType === 'list'}
      <TokenListSelector
        {availableLists}
        bind:selectedList
        on:select={({ detail }) => {
          listName = `${detail.providerKey}/${detail.key}`
          generateUrl()
        }}
      />
    {/if}

    <!-- Network Selection -->
    <NetworkSelect
      bind:isOpen={isNetworkSelectOpen}
      bind:selectedNetwork
      bind:showTestnets
      bind:getNetworkName
      on:select={({ detail }) => selectNetwork(detail)}
    />

    <!-- Token Browser (show when network is selected in token mode) -->
    {#if urlType === 'token' && selectedNetwork && !tokenAddress}
      <TokenBrowser
        {selectedChain}
        networkName={getNetworkName(selectedNetwork.chainId)}
        bind:filteredTokens
        bind:isCircularCrop
        bind:enabledLists
        bind:tokensByList
        bind:isListFilterOpen
        bind:searchQuery
        bind:isGlobalSearchActive
        bind:isSearching
        bind:globalSearchResults
        bind:currentPage
        {tokensPerPage}
        {getNetworkName}
        on:search={() => {
          currentPage = 1
          filterTokens()
        }}
        on:updateResults={({ detail }) => {
          globalSearchResults = detail.tokens
          filteredTokens = detail.tokens
        }}
        on:selectToken={({ detail }) => {
          tokenAddress = detail.token.address
          generateUrl()
        }}
        on:toggleList={handleTokenListToggle}
        on:toggleAll={handleTokenListToggleAll}
      />
    {/if}

    <!-- Manual Token Input -->
    {#if urlType === 'token' && selectedNetwork && tokenAddress}
      <TokenAddressInput
        bind:tokenAddress
        on:back={() => {
          tokenAddress = ''
          generatedUrl = ''
          previewError = false
          iconExists = true
        }}
        on:input={({ detail }) => {
          tokenAddress = detail.address
          generateUrl()
        }}
      />
    {/if}

    <!-- Generated URL Display -->
    {#if generatedUrl}
      <UrlDisplay url={generatedUrl} />

      <!-- Preview -->
      {#if urlType !== 'list' && previewError}
        <ErrorMessage
          {urlType}
          chainId={selectedNetwork?.chainId}
          networkName={getNetworkName(selectedNetwork?.chainId || '')}
          {tokenAddress}
          generatedUrl={generatedUrl}
        />
      {:else if urlType !== 'list' && ((!showTokenBrowser && urlType === 'network') || (urlType === 'token' && tokenAddress))}
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="label">Preview</span>
            <div class="flex items-center gap-2">
              <button class="btn btn-sm variant-soft" on:click={() => isCircularCrop = !isCircularCrop}>
                <i class="fas fa-crop-alt mr-2"></i>
                {isCircularCrop ? 'Square' : 'Circle'}
              </button>
              <span class="text-sm">200%</span>
            </div>
          </div>
          <TokenPreview
            url={generatedUrl}
            bind:previewError
            bind:iconExists
            bind:isCircularCrop
            bind:backgroundColor
            bind:showColorPicker
          />
          {#if filteredTokens.length > 0}
            <div class="text-center text-sm text-surface-600 dark:text-surface-300">
              {filteredTokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase())?.name || 'Unknown Token'}
            </div>
          {/if}
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
  /* Add smooth hover effects for cards */
  .card {
    @apply transition-all duration-200;
  }
</style>
