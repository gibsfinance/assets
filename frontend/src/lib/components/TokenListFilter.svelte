<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  interface $$Slots {
    filter: {}  // Define the filter slot
  }

  const dispatch = createEventDispatcher<{
    toggleList: { listKey: string; enabled: boolean }
    toggleAll: { enabled: boolean }
  }>()

  export let isOpen = false
  export let enabledLists: Set<string>
  export let tokensByList: Map<string, any[]>
  export let selectedChain: number | null

  let listSearchQuery = ''
  let filteredLists: Array<[string, any[]]> = []

  function getListsWithTokensForChain() {
    return Array.from(tokensByList.entries()).filter(([_, tokens]) => {
      const tokensForNetwork = tokens.filter((token) => token.chainId === selectedChain)
      return tokensForNetwork.length > 0
    })
  }

  $: {
    // Filter lists based on search, network, and exclude empty lists
    filteredLists = getListsWithTokensForChain().filter(
      ([key]) => !listSearchQuery || key.toLowerCase().includes(listSearchQuery.toLowerCase()),
    )
  }

  function handleToggleList(listKey: string, checked: boolean) {
    dispatch('toggleList', { listKey, enabled: checked })
  }

  function handleToggleAll() {
    const allEnabled = filteredLists.every(([key]) => enabledLists.has(key))
    dispatch('toggleAll', { enabled: !allEnabled })
  }
</script>

<div class="relative mt-2 sm:mt-0">
  <button
    class="list-filter-dropdown variant-soft-surface btn w-full sm:w-auto"
    on:click={() => {
      isOpen = !isOpen
      if (isOpen) {
        listSearchQuery = ''
        filteredLists = getListsWithTokensForChain()
      }
    }}>
    <i class="fas fa-filter mr-2"></i>
    Lists ({getListsWithTokensForChain().length})
  </button>

  {#if isOpen}
    <div class="list-filter-dropdown card bg-surface-100-800-token absolute right-0 z-50 mt-1 w-64 p-2">
      <div class="space-y-3 p-2">
        <div class="flex items-center justify-between">
          <h3 class="h4">Token Lists</h3>
          <button class="variant-soft btn btn-sm" on:click={handleToggleAll}>
            <i class="fas fa-check-double mr-2"></i>
            Toggle All
          </button>
        </div>

        <div class="input-group input-group-divider grid-cols-[auto_1fr_auto] rounded-container-token">
          <div class="input-group-shim">
            <i class="fas fa-search"></i>
          </div>
          <input type="search" placeholder="Search lists..." class="input" bind:value={listSearchQuery} />
        </div>

        <div class="overflow-y-auto" style="height: 297px">
          {#each filteredLists as [listKey, tokens]}
            <label class="hover:bg-surface-hover flex cursor-pointer items-center gap-2 p-2">
              <input
                type="checkbox"
                class="checkbox"
                checked={enabledLists.has(listKey)}
                on:change={(e) => {
                  const checkbox = e.target as HTMLInputElement
                  handleToggleList(listKey, checkbox.checked)
                }} />
              <div class="flex-1">
                <div class="font-medium">{listKey}</div>
                <div class="text-xs opacity-75">
                  {tokens.filter((token) => token.chainId === selectedChain).length} tokens
                </div>
              </div>
            </label>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style lang="postcss">
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
    @apply rounded-full bg-[#00DC82]/50;
  }
</style>
