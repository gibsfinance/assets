<script lang="ts">
  import { tokensByList, enabledLists } from '../stores/token-browser.svelte'
  import type { Token } from '../types'
  import { Popover } from '@skeletonlabs/skeleton-svelte'

  type Props = {
    selectedChain: number | null
    onupdateopen: (open: boolean) => void
    ontogglelist: (listId: string, enabled: boolean) => void
    ontoggleall: (enabled: boolean) => void
  }
  const { selectedChain, ontogglelist, ontoggleall }: Props = $props()
  let listSearchQuery = $state('')

  const list = $derived(Array.from(tokensByList.entries()))
  const underChain = $derived(getListsWithTokensForChain(list, selectedChain))
  const count = $derived(underChain.length)
  const filteredLists = $derived(
    underChain.filter(([key]) => !listSearchQuery || key.toLowerCase().includes(listSearchQuery.toLowerCase())),
  )

  function getListsWithTokensForChain(list: [string, Token[]][], selectedChain: number | null) {
    return list.filter(([_, tokens]) => {
      const tokensForNetwork = tokens.filter((token) => token.chainId === selectedChain)
      return tokensForNetwork.length > 0
    })
  }

  function handleToggleAll() {
    const allEnabled = filteredLists.every(([key]) => enabledLists.has(key))
    ontoggleall(!allEnabled)
  }
  let open = $state(false)
</script>

<Popover
  {open}
  base="relative flex border-l pl-2 border-surface-500"
  modal
  positioning={{ placement: 'bottom-end', gutter: 0 }}
  onOpenChange={(v) => {
    open = v.open
  }}>
  {#snippet trigger()}
    <span class="list-filter-dropdown w-full sm:w-auto relative flex flex-row items-center">
      <i class="fas fa-filter mr-2"></i>({count})
    </span>
  {/snippet}
  {#snippet content()}
    <div class="list-filter-dropdown card bg-surface-100-900 absolute right-0 z-50 mt-1 w-64 p-2">
      <div class="space-y-3 p-2">
        <div class="flex items-center justify-between">
          <h3 class="h4">Token Lists</h3>
          <button class="variant-soft btn btn-sm" type="button" onclick={handleToggleAll}>
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
                onchange={(e) => {
                  const checkbox = e.target as HTMLInputElement
                  ontogglelist(listKey, checkbox.checked)
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
  {/snippet}
</Popover>

<!-- <div class="relative mt-2 sm:mt-0 flex flex-row-reverse">
  <button
    class="list-filter-dropdown variant-soft-surface btn w-full sm:w-auto"
    type="button"
    onclick={() => {
      const nextOpenValue = !isOpen
      if (nextOpenValue) {
        listSearchQuery = ''
      }
      onupdateopen(nextOpenValue)
    }}>
    <i class="fas fa-filter mr-2"></i>
    Lists ({count})
  </button>

  {#if isOpen}
    <div class="list-filter-dropdown card bg-surface-100-800-token absolute right-0 z-50 mt-1 w-64 p-2">
      <div class="space-y-3 p-2">
        <div class="flex items-center justify-between">
          <h3 class="h4">Token Lists</h3>
          <button class="variant-soft btn btn-sm" type="button" onclick={handleToggleAll}>
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
                onchange={(e) => {
                  const checkbox = e.target as HTMLInputElement
                  ontogglelist(listKey, checkbox.checked)
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
 -->
<!--
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
</style> -->
