<script lang="ts">
  import networkNames from '../networks.json' assert { type: 'json' }
  import { metrics } from '../stores/metrics.svelte'
  import { showTestnets } from '../stores/settings.svelte'
  import type { NetworkInfo } from '../types'
  import { Modal } from '@skeletonlabs/skeleton-svelte'

  type Props = {
    isOpenToStart: boolean
    network: NetworkInfo | null
    showTestnets: boolean
    onselect: (network: NetworkInfo) => void
    onnetworkname: (getName: (id: string | number) => string) => void
  }

  const { isOpenToStart, network: selectedNetwork, onselect, onnetworkname }: Props = $props()

  let isOpen = $state(isOpenToStart)

  // Add this to the existing onMount
  const storedChainId = localStorage.getItem('selectedChainId')
  if (storedChainId && metrics.value) {
    const network = metrics.value.networks.supported.find((n) => n.chainId.toString() === storedChainId)
    if (network) {
      onselect(network)
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
    // dispatch('networkname', getNetworkName)
    onnetworkname(getNetworkName)
  })

  // Sort networks by priority and name
  function sortNetworks(networks: NetworkInfo[]): NetworkInfo[] {
    const priorityChains = ['1', '369'] // Ethereum and PulseChain first

    // Filter out testnets if showTestnets is false
    let filteredNetworks = networks
    if (!showTestnets.value) {
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
  <div class="mb-2 flex items-center justify-end">
    <label class="group flex cursor-pointer items-center gap-3 flex-row">
      <div class="relative flex">
        <input
          type="checkbox"
          class="peer sr-only"
          checked={showTestnets.value}
          onchange={(e) => {
            const target = e.target as HTMLInputElement
            showTestnets.value = target.checked
          }} />
        <div class="h-6 w-11 rounded-full bg-surface-300 dark:bg-surface-600 transition-colors peer-checked:bg-secondary-600/20"></div>
        <div
          class="absolute left-1 top-1 h-4 w-4 rounded-full bg-surface-100 transition-all peer-checked:translate-x-5 peer-checked:bg-secondary-600"
        ></div>
      </div>
      <span
        class="text-sm font-medium text-surface-600 transition-colors group-hover:text-secondary-600 dark:text-surface-300"
        >Show&nbsp;Testnets</span>
    </label>
  </div>
  <Modal
    open={isOpen}
    onOpenChange={(e) => (isOpen = e.open)}
    triggerBase="btn preset-tonal w-full justify-between px-3 py-2 text-left text-sm leading-6 border border-gray-500 hover:border-gray-400 items-center rounded-lg select-network"
    contentBase="bg-surface-100-900 space-y-4 shadow-xl w-[480px] h-screen left-0 overflow-y-auto"
    positionerJustify="justify-start"
    positionerAlign=""
    positionerPadding=""
    transitionsPositionerIn={{ x: -480, duration: 200 }}
    transitionsPositionerOut={{ x: -480, duration: 200 }}>
    {#snippet trigger()}
      {#if selectedNetwork}
        <span class="truncate">{getNetworkName(selectedNetwork.chainId)} (Chain ID: {selectedNetwork.chainId})</span>
      {:else}
        <span class="text-gray-500">Choose a network...</span>
      {/if}
      <i class="fas fa-chevron-down !m-0 flex-shrink-0 transition-transform flex items-center" class:rotate-180={isOpen}
      ></i>
    {/snippet}
    {#snippet content()}
      <article>
        {#if metrics.value}
          {#each sortNetworks(metrics.value.networks.supported) as network}
            <button
              class="flex w-full items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-secondary-600 dark:hover:bg-secondary-600"
              class:selected={selectedNetwork?.chainId === network.chainId}
              onclick={() => {
                isOpen = false
                onselect(network)
              }}>
              <span class="mr-2 truncate">{getNetworkName(network.chainId)}</span>
              <span class="flex-shrink-0 whitespace-nowrap text-surface-500">(Chain ID: {network.chainId})</span>
            </button>
          {/each}
        {/if}
      </article>
    {/snippet}
  </Modal>
</div>
