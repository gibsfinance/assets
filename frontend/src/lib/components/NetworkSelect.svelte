<script lang="ts">
  import networkNames from '$lib/networks.json' assert { type: 'json' }
  import { metrics } from '$lib/stores/metrics'
  import { showTestnets } from '$lib/stores/settings'
  import type { NetworkInfo } from '$lib/types'
  import { createEventDispatcher, onMount } from 'svelte'

  const dispatch = createEventDispatcher<{
    select: NetworkInfo
    networkname: (chainId: number | string) => string
  }>()

  let { isOpen = $bindable(false), selectedNetwork = $bindable<NetworkInfo | null>(null) } = $props()

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

  // Add this to the existing onMount
  const storedChainId = localStorage.getItem('selectedChainId')
  if (storedChainId && $metrics) {
    const network = $metrics.networks.supported.find((n) => n.chainId.toString() === storedChainId)
    if (network) {
      selectedNetwork = network
      dispatch('select', network)
    }
    // Clear the stored chain ID after using it
    localStorage.removeItem('selectedChainId')
  }

  // Network name function for use in component and parent
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

  // Expose getNetworkName to parent
  $effect(() => {
    dispatch('networkname', getNetworkName)
  })

  // Sort networks by priority and name
  function sortNetworks(networks: NetworkInfo[]): NetworkInfo[] {
    const priorityChains = ['1', '369'] // Ethereum and PulseChain first

    // Filter out testnets if showTestnets is false
    let filteredNetworks = networks
    if (!$showTestnets) {
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
  <div class="mb-2 flex items-center justify-between">
    <label for="network-select" class="label">
      <span class="leading-5">Select Network</span>
    </label>
    <label class="group flex cursor-pointer items-center gap-3">
      <div class="relative">
        <input type="checkbox" class="peer sr-only" bind:checked={$showTestnets} />
        <div class="h-6 w-11 rounded-full bg-surface-700/20 transition-colors peer-checked:bg-[#00DC82]/20"></div>
        <div
          class="absolute left-1 top-1 h-4 w-4 rounded-full bg-surface-200 transition-all peer-checked:translate-x-5 peer-checked:bg-[#00DC82]"
        ></div>
      </div>
      <span
        class="text-sm font-medium text-surface-600 transition-colors group-hover:text-[#00DC82] dark:text-surface-300"
        >Show Testnets</span>
    </label>
  </div>
  <button
    type="button"
    id="network-select"
    class="select flex w-full items-center justify-between px-3 py-2 text-left text-sm leading-6"
    onclick={() => (isOpen = !isOpen)}>
    {#if selectedNetwork}
      <span class="truncate">{getNetworkName(selectedNetwork.chainId)} (Chain ID: {selectedNetwork.chainId})</span>
    {:else}
      <span class="text-gray-500">Choose a network...</span>
    {/if}
    <i class="fas fa-chevron-down ml-2 flex-shrink-0 transition-transform" class:rotate-180={isOpen}></i>
  </button>

  {#if isOpen}
    <div
      class="absolute z-50 mt-1 max-h-[300px] w-full overflow-y-auto border border-gray-200 bg-white text-sm shadow-lg rounded-container-token dark:border-surface-700/20 dark:bg-[#202633]">
      {#if $metrics}
        {#each sortNetworks($metrics.networks.supported) as network}
          <button
            class="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-[#00DC82]/10 dark:hover:bg-[#00DC82]/20"
            class:selected={selectedNetwork?.chainId === network.chainId}
            onclick={() => {
              selectedNetwork = network
              isOpen = false
              dispatch('select', network)
            }}>
            <span class="mr-2 truncate">{getNetworkName(network.chainId)}</span>
            <span class="flex-shrink-0 whitespace-nowrap text-surface-500">(Chain ID: {network.chainId})</span>
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
