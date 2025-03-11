<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { NetworkInfo } from '$lib/types'
  import { getApiUrl } from '$lib/utils'
  import { metrics } from '$lib/stores/metrics'

  export let searchQuery = ''
  export let isGlobalSearchActive = false
  export let isSearching = false
  export let selectedChain: number | null | undefined = undefined

  const dispatch = createEventDispatcher<{
    search: { query: string }
    globalSearch: { query: string }
    updateResults: { tokens: any[] }
  }>()

  let searchAbortController: AbortController | null = null

  async function performGlobalSearch() {
    // Cancel any previous ongoing search
    if (searchAbortController) {
      searchAbortController.abort()
    }
    // Create new abort controller for this search
    searchAbortController = new AbortController()

    isGlobalSearchActive = true
    isSearching = true
    dispatch('updateResults', { tokens: [] })
    const searchTerm = searchQuery.toLowerCase()

    try {
      // Split lists into global and chain-specific
      const response = await fetch(getApiUrl('/list'))
      if (!response.ok) return

      const availableLists = await response.json()
      const globalLists = availableLists.filter((list: any) => list.chainId === '0')
      const chainSpecificLists = availableLists.filter((list: any) => list.chainId !== '0')

      console.log('Starting global search')
      let globalSearchResults: any[] = []

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
                  (token: any) =>
                    token.name.toLowerCase().includes(searchTerm) ||
                    token.symbol.toLowerCase().includes(searchTerm) ||
                    token.address.toLowerCase().includes(searchTerm),
                )
                .map((token: any) => ({
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
            return
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
                  (token: any) =>
                    token.name.toLowerCase().includes(searchTerm) ||
                    token.symbol.toLowerCase().includes(searchTerm) ||
                    token.address.toLowerCase().includes(searchTerm),
                )
                .map((token: any) => ({
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
          } else if (response.status === 404) {
            // Silently skip 404s - this is normal as not all chains have all lists
            continue
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('Search aborted')
            return
          }
          // Only log non-404 errors
          if (error instanceof Error && !error.message.includes('404')) {
            console.error(`Error searching chain-specific list ${list.providerKey}/${list.key}:`, error)
          }
        }
      }

      // Remove duplicates and update results
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

      dispatch('updateResults', { tokens: globalSearchResults })
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Global search error:', error)
      }
    } finally {
      isSearching = false
    }
  }

  function handleInput() {
    if (!isGlobalSearchActive) {
      dispatch('search', { query: searchQuery })
    }
  }
</script>

<div class="flex flex-col gap-2 sm:flex-row">
  <!-- Search bar -->
  <div class="input-group input-group-divider flex-1 grid-cols-[auto_1fr_auto] rounded-container-token">
    <div class="input-group-shim">
      <i class="fas fa-search"></i>
    </div>
    <input type="search" placeholder="Search tokens..." class="input" bind:value={searchQuery} on:input={handleInput} />
    <button class="input-group-shim variant-soft-primary btn" on:click={performGlobalSearch} disabled={!searchQuery}>
      <i class="fas fa-globe"></i>
      <span class="ml-2 hidden sm:inline">Search All</span>
    </button>
  </div>
</div>

<!-- Slot for filter -->
<slot name="filter" />
