<script lang="ts">
  import Image from '$lib/components/Image.svelte'
  import networkNames from '$lib/networks.json' assert { type: 'json' }
  import { metrics } from '$lib/stores/metrics'
  import type { FloatingToken, Hex, PlatformMetrics, PositionType } from '$lib/types'
  import { getApiUrl, initializeApiBase } from '$lib/utils'
  import Icon from '@iconify/svelte'
  import { onMount } from 'svelte'
  import { showTestnets } from '$lib/stores/settings'

  let metricsData: PlatformMetrics | null = null
  let pageHeight: number
  let isInitialized = false

  // Add type for getNetworkName function
  let getNetworkName: (chainId: number | string) => string = (chainId) => {
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
    const name = priorityNames[chainIdStr] || (networkNames as Record<string, string>)[chainIdStr]
    return name || `Chain ${chainId}`
  }

  // Add type for metrics data
  type NetworkInfo = {
    chainId: number
  }

  type MetricsData = {
    networks: {
      supported: NetworkInfo[]
    }
    tokenList: {
      byChain: Record<number, number>
      total: number
    }
  }

  metrics.subscribe((value) => {
    metricsData = value
  })

  onMount(async () => {
    await initializeApiBase()
    isInitialized = true
    metrics.fetchMetrics()
    pageHeight = document.documentElement.scrollHeight
    window.addEventListener('resize', () => {
      pageHeight = document.documentElement.scrollHeight
    })
  })

  // Define features data
  const features = [
    {
      icon: 'fa-cloud',
      title: 'Always Available',
      description:
        'Decentralized storage ensures your token assets are always accessible. No more missing images or failed requests.',
    },
    {
      icon: 'fa-bolt',
      title: 'Lightning Fast',
      description: 'Optimized delivery with global CDN and efficient caching. Get token data in milliseconds.',
    },
    {
      icon: 'fa-shield',
      title: 'Reliable & Secure',
      description: 'Verified token data from trusted sources. No more scam tokens or incorrect metadata.',
    },
  ]

  // Define examples data
  const examples = [
    {
      icon: 'fa-image',
      title: 'Get Token Image',
      description: 'Fetch token logo for any token on any supported chain. Automatically handles fallback assets.',
      code: getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
      displayUrl: '#/image/1/0x2260...',
    },
    {
      icon: 'fa-network-wired',
      title: 'Get Network Logo',
      description: 'Get chain/network logos and metadata. Perfect for network selectors.',
      code: getApiUrl('/image/1'),
      displayUrl: '#/image/1',
    },
    {
      icon: 'fa-list',
      title: 'Get Token List',
      description: 'Get curated token lists with optional network filtering.',
      code: getApiUrl('/list/coingecko'),
      displayUrl: '#/list/coingecko',
    },
  ]

  // Define token list
  const tokenList = [
    { chainId: 1, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' }, // WBTC
    { chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' }, // DAI
    { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }, // USDC
    { chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }, // USDT
    { chainId: 369, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' }, // PLS WBTC
    { chainId: 369, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' }, // PLS DAI
    { chainId: 369, address: '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39' }, // PLS HEX
    { chainId: 369, address: '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d' }, // INC
    { chainId: 369, address: '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab' }, // PLSX
    { chainId: 56, address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' }, // BSC PancakeSwap
  ]

  // Function to generate random floating images
  function generateFloatingImages(): FloatingToken[] {
    const networkImages = [
      { chainId: 1 }, // Ethereum
      { chainId: 10 }, // Optimism
      { chainId: 56 }, // BSC
      { chainId: 100 }, // Gnosis
      { chainId: 137 }, // Polygon
      { chainId: 324 }, // zkSync
      { chainId: 369 }, // PulseChain
      { chainId: 42161 }, // Arbitrum
      { chainId: 534352 }, // Scroll
    ]

    // Helper function to get random value in range
    const random = (min: number, max: number) => Math.random() * (max - min) + min

    // Generate network images (background and middle)
    const backgroundNetworks = networkImages.map((network) => ({
      type: 'network' as const,
      chainId: network.chainId,
      size: random(20, 30), // Random size between 20-30px (smaller)
      speed: random(80, 90), // Random animation duration 80-90s (slower)
      delay: Math.random() < 0.5 ? random(0, 5) : random(10, 25), // Spread second wave over longer period
      direction: Math.random() > 0.5 ? 1 : -1, // 50% chance left or right
      layer: 'back' as PositionType, // Always in background
      startPos: random(0, 100), // Random starting position 0-100% of viewport width
    }))

    // Generate random token images
    const randomTokens = tokenList.map((token) => ({
      type: 'token' as const,
      chainId: token.chainId,
      address: token.address as Hex,
      size: random(40, 80), // Random size between 40-80px (larger)
      speed: random(55, 75), // Random animation duration 55-75s (faster)
      delay: Math.random() < 0.5 ? random(0, 5) : random(10, 25), // Spread second wave over longer period
      direction: Math.random() > 0.5 ? 1 : -1, // 50% chance left or right
      layer: (random(0, 1) > 0.5 ? 'middle' : 'front') as PositionType, // Random layer
      startPos: random(0, 100), // Random starting position 0-100% of viewport width
    }))

    // Combine all images
    return [
      ...backgroundNetworks,
      ...randomTokens,
      // Add monster with small chance
      ...(Math.random() < 0.04
        ? [
            {
              // 4% chance to appear
              size: 168, // Fixed large size
              speed: 65, // Fixed speed
              delay: 18, // Fixed delay
              direction: -1, // Always moves left
              layer: 'front' as PositionType, // Always in front
              startPos: random(0, 125), // Random start position, can start slightly off-screen
            },
          ]
        : []),
    ]
  }

  // Generate the floating images
  const floatingImages = generateFloatingImages()
</script>

{#if !isInitialized}
  <div class="flex min-h-screen items-center justify-center">
    <div class="space-y-4 text-center">
      <div class="loading loading-spinner loading-lg"></div>
      <p>Initializing...</p>
    </div>
  </div>
{:else}
  <div class="flex min-h-screen flex-col">
    <div class="relative z-10 flex-1">
      <div class="mx-auto space-y-8">
        <!-- Hero Section -->
        <section class="relative space-y-6 overflow-hidden rounded-lg py-8">
          <div class="absolute inset-0 -z-10 overflow-hidden blur-3xl">
            <div class="absolute -right-4 -top-4 h-72 w-96 rounded-full bg-[#00DC82]/10 blur-3xl"></div>
            <div class="absolute -bottom-4 -left-4 h-72 w-96 rounded-full bg-[#00DC82]/10 blur-3xl"></div>
          </div>

          <div class="space-y-2">
            <p
              class="font-space-grotesk w-full text-center text-lg font-medium tracking-wide text-gray-600 dark:text-gray-400">
              Welcome to
            </p>
            <h1
              class="font-space-grotesk w-full bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-center text-6xl font-bold tracking-tight text-transparent">
              Gib<span class="text-[#00DC82]">.Show</span>
            </h1>
          </div>

          <p class="mx-auto max-w-3xl text-xl font-medium text-gray-600 dark:text-gray-400">
            A decentralized solution for token metadata and assets across multiple blockchains. Stop struggling with
            missing logos, broken images, and inconsistent token data. One API to handle all your token asset needs.
          </p>
        </section>

        <!-- Features Grid -->
        <section class="space-y-8 py-8">
          <h2 class="h2 text-center text-3xl font-bold">Why Use Gib's Assets?</h2>
          <div class="grid grid-cols-1 gap-6 md:grid-cols-3">
            {#each features as feature}
              <div
                class="feature-card group rounded-lg border border-gray-200 bg-white p-6 transition-all hover:scale-[1.02] hover:shadow-lg dark:border-surface-700/20 dark:bg-[#202633]">
                <div class="relative">
                  <div class="absolute inset-0 -z-10 rounded-lg transition-colors"></div>
                  <i class="fas {feature.icon} mb-4 text-4xl text-[#00DC82] transition-transform group-hover:scale-110"
                  ></i>
                  <h3 class="h3 mb-2 font-bold">{feature.title}</h3>
                  <p class="text-gray-600 dark:text-gray-300">{feature.description}</p>
                </div>
              </div>
            {/each}
          </div>
        </section>

        <!-- Integration Examples -->
        <section class="space-y-8 py-8">
          <h2 class="h2 text-center text-3xl font-bold">Simple Integration</h2>
          <div class="grid gap-6">
            {#each examples as example}
              <div class="card p-6 transition-all hover:shadow-lg hover:shadow-[#00DC82]/5">
                <div class="grid gap-6 md:grid-cols-2">
                  <!-- Visual Preview -->
                  <div class="flex items-center justify-center rounded-lg bg-surface-700/10 p-4">
                    {#if example.title === 'Get Token Image'}
                      <div class="flex items-center gap-4">
                        <img
                          src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
                          alt="WBTC Token"
                          class="h-12 w-12 rounded-full" />
                        <i class="fas fa-arrow-right text-[#00DC82]"></i>
                        <div class="rounded bg-surface-700/20 p-2 font-mono text-sm">
                          {example.displayUrl}
                        </div>
                      </div>
                    {:else if example.title === 'Get Network Logo'}
                      <div class="flex items-center gap-4">
                        <img src={getApiUrl('/image/1')} alt="Ethereum" class="h-12 w-12 rounded-full" />
                        <i class="fas fa-arrow-right text-[#00DC82]"></i>
                        <div class="rounded bg-surface-700/20 p-2 font-mono text-sm">
                          {example.displayUrl}
                        </div>
                      </div>
                    {:else}
                      <div class="flex items-center gap-4">
                        <div class="flex -space-x-4">
                          <img
                            src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
                            alt="Token 1"
                            class="h-12 w-12 rounded-full border-2 border-surface-700/20" />
                          <img
                            src={getApiUrl('/image/1/0x6B175474E89094C44Da98b954EedeAC495271d0F')}
                            alt="Token 2"
                            class="h-12 w-12 rounded-full border-2 border-surface-700/20" />
                          <img
                            src={getApiUrl('/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')}
                            alt="Token 3"
                            class="h-12 w-12 rounded-full border-2 border-surface-700/20" />
                        </div>
                        <i class="fas fa-arrow-right text-[#00DC82]"></i>
                        <div class="rounded bg-surface-700/20 p-2 font-mono text-sm">
                          {example.displayUrl}
                        </div>
                      </div>
                    {/if}
                  </div>

                  <!-- Description -->
                  <div class="space-y-4">
                    <div class="flex items-center gap-4">
                      <div class="rounded-lg bg-[#00DC82]/10 p-3">
                        <i class="fas {example.icon} text-2xl text-[#00DC82]"></i>
                      </div>
                      <h3 class="h3 font-bold">{example.title}</h3>
                    </div>
                    <p class="text-gray-600 dark:text-gray-300">{example.description}</p>
                    <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <i class="fas fa-link text-[#00DC82]"></i>
                      <code class="break-all font-mono">{example.code}</code>
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </section>

        <!-- Metrics -->
        <section class="space-y-8 py-8">
          <h2 class="h2 text-center text-3xl font-bold">Platform Metrics</h2>
          <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div
              class="metric-card group rounded-lg border border-gray-200 bg-white p-6 transition-all hover:shadow-lg hover:shadow-[#00DC82]/5 dark:border-surface-700/20 dark:bg-[#202633]">
              {#if $metrics}
                {@const networks = $metrics.networks.supported
                  .filter((n) => !getNetworkName(n.chainId).toLowerCase().includes('testnet'))
                  .map((n) => ({
                    chainId: n.chainId,
                    name: getNetworkName(n.chainId),
                    tokenCount: $metrics.tokenList.byChain[n.chainId] || 0,
                  }))
                  .filter((n) => n.tokenCount > 0)
                  .sort((a, b) => b.tokenCount - a.tokenCount)}
                {@const totalTokens = $metrics.tokenList.total}
                <span
                  class="mb-2 block bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-center text-5xl font-bold text-transparent">
                  {totalTokens.toLocaleString()}+
                </span>
              {:else}
                <span class="mb-2 block animate-pulse text-center text-5xl font-bold">---</span>
              {/if}
              <p class="text-center text-lg text-gray-600 dark:text-gray-300">Total Tokens</p>
            </div>
            <div
              class="metric-card group rounded-lg border border-gray-200 bg-white p-6 transition-all hover:shadow-lg hover:shadow-[#00DC82]/5 dark:border-surface-700/20 dark:bg-[#202633]">
              {#if $metrics}
                <span
                  class="mb-2 block bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-center text-5xl font-bold text-transparent">
                  {$metrics.networks.supported.filter(
                    (n) => !getNetworkName(n.chainId).toLowerCase().includes('testnet'),
                  ).length}
                </span>
              {:else}
                <span class="mb-2 block animate-pulse text-center text-5xl font-bold">---</span>
              {/if}
              <p class="text-center text-lg text-gray-600 dark:text-gray-300">Supported Networks</p>
            </div>
          </div>

          <!-- Token Distribution Visualization -->
          {#if metricsData}
            {@const networks = metricsData.networks.supported
              .map((n: NetworkInfo) => ({
                chainId: n.chainId,
                name: getNetworkName(n.chainId),
                tokenCount: metricsData?.tokenList.byChain[n.chainId] || 0,
                isTestnet: getNetworkName(n.chainId).toLowerCase().includes('testnet'),
              }))
              .filter((n) => n.tokenCount > 0)
              .sort((a, b) => {
                // Sort mainnet networks first, then by token count
                if (!a.isTestnet && b.isTestnet) return -1
                if (a.isTestnet && !b.isTestnet) return 1
                return b.tokenCount - a.tokenCount
              })}
            {@const totalTokens = metricsData.tokenList.total}

            <div class="card p-4">
              <h3 class="h3 mb-4 text-center">Tokens by Chain</h3>

              <!-- Add testnet toggle -->
              <div class="mb-4 flex justify-end">
                <label class="group flex cursor-pointer items-center gap-3">
                  <div class="relative">
                    <input type="checkbox" class="peer sr-only" bind:checked={$showTestnets} />
                    <div class="h-6 w-11 rounded-full bg-surface-700/20 transition-colors peer-checked:bg-[#00DC82]/20"
                    ></div>
                    <div
                      class="absolute left-1 top-1 h-4 w-4 rounded-full bg-surface-200 transition-all peer-checked:translate-x-5 peer-checked:bg-[#00DC82]"
                    ></div>
                  </div>
                  <span
                    class="text-sm font-medium text-surface-600 transition-colors group-hover:text-[#00DC82] dark:text-surface-300"
                    >Show Testnets</span>
                </label>
              </div>

              <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {#each networks.filter((n) => $showTestnets || !n.isTestnet) as network}
                  {@const intensity = Math.max(
                    0.2,
                    network.tokenCount / Math.max(...networks.map((n) => n.tokenCount)),
                  )}
                  <a
                    href="#/wizard"
                    on:click|preventDefault={() => {
                      // Navigate to wizard and set the selected network in localStorage
                      localStorage.setItem('selectedChainId', network.chainId.toString())
                      window.location.href = '#/wizard'
                    }}
                    class="group relative cursor-pointer transition-all duration-200 hover:scale-105">
                    <div class="absolute inset-0 rounded-lg bg-[#00DC82]" style="opacity: {intensity * 0.15}"></div>
                    <div
                      class="card variant-ghost relative flex h-[160px] flex-col items-center justify-between rounded-lg border border-[#00DC82]/20 p-3 hover:border-[#00DC82]/40">
                      <div class="flex flex-1 flex-col items-center">
                        <Image
                          src={getApiUrl(`/image/${network.chainId}`)}
                          alt={network.name}
                          class="h-10 w-10 flex-shrink-0 rounded-full">
                          {#snippet fallback()}
                            <Icon icon="nrk:404" class="h-8 w-8" />
                          {/snippet}
                        </Image>
                        <div class="mt-2 flex w-full flex-1 flex-col justify-center text-center">
                          <div class="line-clamp-2 px-1 text-sm font-medium leading-tight" title={network.name}
                            >{network.name}</div>
                          <div class="mt-1 font-mono text-xs text-surface-500">ID: {network.chainId}</div>
                        </div>
                      </div>
                      <div class="mt-2 flex-shrink-0 text-base font-bold text-[#00DC82]"
                        >{network.tokenCount.toLocaleString()}</div>
                    </div>
                  </a>
                {/each}
              </div>
            </div>
          {:else}
            <div class="card p-4">
              <div class="h-[400px] animate-pulse bg-surface-600/20"></div>
            </div>
          {/if}
        </section>

        <!-- CTA -->
        <section class="card mb-8 space-y-4 p-8 text-center">
          <h2 class="h2">Ready to Get Started?</h2>
          <p class="text-lg">Try our URL wizard to generate the perfect integration for your needs.</p>
          <a href="#/wizard" class="btn bg-[#00DC82] text-black">
            <i class="fas fa-hat-wizard mr-2"></i>
            Wizard
          </a>
        </section>
      </div>
    </div>

    <!-- Update the floating images container -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" style="z-index: 1; height: {pageHeight}px;">
      {#each floatingImages as image}
        <div
          class="animate-float absolute rounded-full"
          style="
					width: {image.size}px;
					height: {image.size}px;
					--duration: {image.speed}s;
					animation-delay: {image.delay}s;
					top: {Math.random() * pageHeight}px;
					left: {image.direction === 1 ? '-100px' : '100vw'};
					opacity: 0;
					--direction: {image.direction};
				">
          <Image
            src={image.type === 'network'
              ? getApiUrl(`/image/${image.chainId}`)
              : getApiUrl(`/image/${image.chainId}/${image.address}`)}
            alt={image.type === 'network' ? 'Network icon' : 'Token icon'}
            class="h-full w-full rounded-full opacity-10">
            {#snippet fallback(p)}
              <Icon icon="nrk:404" />
            {/snippet}
          </Image>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style lang="postcss">
  .gradient-heading {
    @apply bg-gradient-to-br from-primary-500 to-secondary-500 bg-clip-text font-bold text-transparent;
  }

  @keyframes float-right {
    0% {
      opacity: 0;
      transform: translateX(100px) rotate(0deg);
    }
    5% {
      opacity: 1;
    }
    95% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateX(100vw) rotate(360deg);
    }
  }

  @keyframes float-left {
    0% {
      opacity: 0;
      transform: translateX(5vw) rotate(360deg);
    }
    10% {
      opacity: 1;
    }
    95% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateX(-100vw) rotate(0deg);
    }
  }

  .animate-float {
    animation: float-right var(--duration) linear infinite;
    will-change: transform, opacity;
  }

  .animate-float[style*='--direction: -1'] {
    animation: float-left var(--duration) linear infinite !important;
  }

  /* Add smooth hover effects for cards */
  .card {
    @apply transition-all duration-200;
  }

  /* Ensure text truncation works properly */
  .truncate {
    @apply max-w-full overflow-hidden text-ellipsis;
  }
</style>
