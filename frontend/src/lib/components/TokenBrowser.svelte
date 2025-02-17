<script lang="ts">
  import Image from '$lib/components/Image.svelte'
  import PaginationControls from '$lib/components/PaginationControls.svelte'
  import TokenListFilter from '$lib/components/TokenListFilter.svelte'
  import TokenSearch from '$lib/components/TokenSearch.svelte'
  import type { Token } from '$lib/types'
  import { getApiUrl } from '$lib/utils'
  import Icon from '@iconify/svelte'
  import { createEventDispatcher } from 'svelte'

  export let selectedChain: number | null = null
  export let networkName: string
  export let filteredTokens: Token[] = []
  export let isCircularCrop: boolean = false
  export let enabledLists: Set<string>
  export let tokensByList: Map<string, Token[]>
  export let isListFilterOpen: boolean = false
  export let searchQuery: string = ''
  export let isGlobalSearchActive: boolean = false
  export let isSearching: boolean = false
  export let globalSearchResults: Token[] = []
  export let currentPage: number = 1
  export let tokensPerPage: number = 25
  export let getNetworkName: (chainId: number | string) => string

  const dispatch = createEventDispatcher<{
    search: void
    updateResults: { tokens: Token[] }
    selectToken: { token: Token }
    toggleList: { listKey: string; enabled: boolean }
    toggleAll: { enabled: boolean }
  }>()
</script>

<div class="card variant-ghost space-y-2 p-1 sm:p-2">
  <div class="space-y-2">
    <!-- Chain Token Count Header -->
    <div class="flex items-center justify-between">
      <span class="font-medium">
        {filteredTokens.length}
        {filteredTokens.length === 1 ? 'token' : 'tokens'} on {networkName}
      </span>
    </div>

    <!-- Search and Filter -->
    <div class="flex gap-1">
      <TokenSearch
        bind:searchQuery
        bind:isGlobalSearchActive
        bind:isSearching
        {selectedChain}
        on:search={() => dispatch('search')}
        on:updateResults={({ detail }) => dispatch('updateResults', { tokens: detail.tokens })} />

      <!-- List filter dropdown -->
      <TokenListFilter
        bind:isOpen={isListFilterOpen}
        {enabledLists}
        {tokensByList}
        {selectedChain}
        on:toggleList={({ detail }) => dispatch('toggleList', detail)}
        on:toggleAll={({ detail }) => dispatch('toggleAll', detail)} />
    </div>

    {#if filteredTokens.length === 0 && !isSearching}
      <div class="p-4 text-center text-gray-500">
        {searchQuery ? 'No tokens match your search' : 'Loading tokens...'}
      </div>
    {:else if isSearching}
      <div class="p-4 text-center">
        <div class="spinner"></div>
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
            {#each filteredTokens.slice((currentPage - 1) * tokensPerPage, currentPage * tokensPerPage) as token}
              <tr
                class="cursor-pointer transition-colors hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20"
                on:click={() => dispatch('selectToken', { token })}>
                <td class="p-1">
                  <div class="flex items-center gap-2">
                    <div
                      class="relative flex h-10 min-h-[40px] w-10 min-w-[40px] items-center justify-center bg-surface-700 {isCircularCrop
                        ? 'rounded-full'
                        : ''}">
                      {#if token.hasIcon}
                        <Image
                          src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                          alt={token.symbol}
                          class="user-drag-none object-contain {isCircularCrop ? 'rounded-full' : ''}"
                          size={32}
                          onerror={() => {
                            token.hasIcon = false
                            // Force Svelte to update this token in the list
                            filteredTokens = [...filteredTokens]
                            if (isGlobalSearchActive) {
                              globalSearchResults = [...globalSearchResults]
                            }
                          }} />
                      {:else}
                        <Icon icon="nrk:404" class="h-8 w-8 text-surface-50" />
                      {/if}
                    </div>
                    <div class="flex flex-col">
                      <span class="font-medium">{token.name}</span>
                      <div class="flex items-center gap-2">
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
                <td title={isGlobalSearchActive ? getNetworkName(token.chainId) : networkName}>
                  <span class="text-sm">{isGlobalSearchActive ? getNetworkName(token.chainId) : networkName}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <span class="text-sm text-surface-600 dark:text-surface-300">Show</span>
          <select class="select !h-7 !py-0 text-sm" bind:value={tokensPerPage} on:change={() => (currentPage = 1)}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span class="text-sm text-surface-600 dark:text-surface-300">tokens</span>
        </div>
        <PaginationControls bind:currentPage totalItems={filteredTokens.length} {tokensPerPage} />
      </div>
    {/if}
  </div>
</div>

<style lang="postcss">
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

  .table-container {
    width: 100%;
    overflow-x: auto;
    margin: 1rem 0;
  }

  .spinner {
    @apply mx-auto h-8 w-8 rounded-full border-4 border-primary-500/20 border-t-primary-500;
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
</style>
