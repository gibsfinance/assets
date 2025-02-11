<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  
  const dispatch = createEventDispatcher<{
    toggleList: { listKey: string; enabled: boolean }
    toggleAll: { enabled: boolean }
  }>()

  export let isOpen = false
  export let enabledLists: Set<string>
  export let tokensByList: Map<string, any[]>
  
  let listSearchQuery = ''
  let filteredLists: Array<[string, any[]]> = []

  $: {
    // Filter lists based on search and exclude empty lists
    filteredLists = Array.from(tokensByList.entries()).filter(
      ([key, tokens]) =>
        tokens.length > 0 && // Only include lists with tokens
        (!listSearchQuery || key.toLowerCase().includes(listSearchQuery.toLowerCase())),
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

<div class="relative">
  <button
    class="btn variant-soft-surface list-filter-dropdown"
    on:click={() => {
      isOpen = !isOpen
      if (isOpen) {
        listSearchQuery = ''
        filteredLists = Array.from(tokensByList.entries()).filter(([_, tokens]) => tokens.length > 0)
      }
    }}>
    <i class="fas fa-filter mr-2"></i>
    Lists ({enabledLists.size})
  </button>

  {#if isOpen}
    <div class="absolute right-0 mt-1 w-64 bg-surface-100-800-token card p-2 z-50 list-filter-dropdown">
      <div class="p-2 space-y-3">
        <div class="flex justify-between items-center">
          <h3 class="h4">Token Lists</h3>
          <button class="btn btn-sm variant-soft" on:click={handleToggleAll}>
            <i class="fas fa-check-double mr-2"></i>
            Toggle All
          </button>
        </div>

        <div class="input-group input-group-divider grid-cols-[auto_1fr_auto] rounded-container-token">
          <div class="input-group-shim">
            <i class="fas fa-search"></i>
          </div>
          <input
            type="search"
            placeholder="Search lists..."
            class="input"
            bind:value={listSearchQuery} />
        </div>

        <div class="overflow-y-auto" style="height: 297px">
          {#each filteredLists as [listKey, tokens]}
            <label class="flex items-center gap-2 p-2 hover:bg-surface-hover cursor-pointer">
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
                <div class="text-xs opacity-75">{tokens.length} tokens</div>
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
    @apply bg-[#00DC82]/50 rounded-full;
  }
</style> 