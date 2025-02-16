<script lang="ts">
  import type { NetworkInfo } from '$lib/types'
  import networkNames from '$lib/networks.json' assert { type: 'json' }
  import { metrics } from '$lib/stores/metrics'
  import { onMount, createEventDispatcher } from 'svelte'

  const dispatch = createEventDispatcher<{
    select: NetworkInfo
  }>()

  let isOpen = $state(false)
  let selectedNetwork = $state<NetworkInfo | null>(null)
  let showTestnets = $state(false)

  // Add click outside handler for network select
  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (isOpen && !(e.target as HTMLElement).closest('.select')) {
        isOpen = false
      }
    }
    document.addEventListener('click', handler)
    return () => {
      document.removeEventListener('click', handler)
    }
  })

  // Export getNetworkName for use in parent component
  export function getNetworkName(chainId: number | string): string {
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
</script>

<div class="relative w-full">
  <div class="flex justify-between items-center mb-2">
    <label class="label">
      <span class="leading-5">Select Network</span>
    </label>
    <label class="flex items-center gap-3 cursor-pointer group">
      <div class="relative">
        <input
          type="checkbox"
          class="sr-only peer"
          bind:checked={showTestnets}
        />
        <div class="w-11 h-6 bg-surface-700/20 rounded-full peer-checked:bg-[#00DC82]/20 transition-colors"></div>
        <div class="absolute left-1 top-1 w-4 h-4 bg-surface-200 rounded-full transition-all peer-checked:bg-[#00DC82] peer-checked:translate-x-5"></div>
      </div>
      <span class="text-sm font-medium text-surface-600 dark:text-surface-300 group-hover:text-[#00DC82] transition-colors">Show Testnets</span>
    </label>
  </div>
  <button
    type="button"
    class="select w-full text-left flex justify-between items-center py-2 px-3 text-sm leading-6"
    on:click={() => (isOpen = !isOpen)}>
    {#if selectedNetwork}
      <span class="truncate">{getNetworkName(selectedNetwork.chainId)} (Chain ID: {selectedNetwork.chainId})</span>
    {:else}
      <span class="text-gray-500">Choose a network...</span>
    {/if}
    <i class="fas fa-chevron-down transition-transform flex-shrink-0 ml-2" class:rotate-180={isOpen}></i>
  </button>

  {#if isOpen}
    <div
      class="absolute z-50 w-full mt-1 bg-white dark:bg-[#202633] border border-gray-200 dark:border-surface-700/20 shadow-lg max-h-[300px] overflow-y-auto text-sm rounded-container-token">
      {#if $metrics}
        {#each sortNetworks($metrics.networks.supported) as network}
          <button
            class="w-full px-3 py-1.5 text-left hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20 transition-colors flex items-center justify-between"
            class:selected={selectedNetwork?.chainId === network.chainId}
            on:click={() => {
              selectedNetwork = network
              isOpen = false
              dispatch('select', network)
            }}>
            <span class="truncate mr-2">{getNetworkName(network.chainId)}</span>
            <span class="text-surface-500 whitespace-nowrap flex-shrink-0">(Chain ID: {network.chainId})</span>
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style lang="postcss">
  .selected {
    @apply bg-[#00DC82]/20;
  }
</style> 