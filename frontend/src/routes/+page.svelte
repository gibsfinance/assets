<script lang="ts">
  import { onMount } from 'svelte'
  import { metrics } from '$lib/stores/metrics'
  import type { PlatformMetrics, TokenInfo, FloatingToken, PositionType, Hex } from '$lib/types'
  import { getApiUrl } from '$lib/utils'

  let metricsData: PlatformMetrics | null = null
  let pageHeight: number
  let tokenAddress = ''

  metrics.subscribe((value) => {
    metricsData = value
  })

  onMount(() => {
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
      code: getApiUrl('/list/default'),
      displayUrl: '#/list/default',
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

  // Add fallback icon definition
  const fallbackIcon =
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTggMTRzMS41IDIgNCAyIDQtMiA0LTIiLz48bGluZSB4MT0iOSIgeTE9IjkiIHgyPSI5LjAxIiB5Mj0iOSIvPjxsaW5lIHgxPSIxNSIgeTE9IjkiIHgyPSIxNS4wMSIgeTI9IjkiLz48L3N2Zz4='

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
      delay: random(0, 15), // Random start delay 0-15s
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
      delay: random(0, 20), // Random start delay 0-20s
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

<div class="min-h-screen flex flex-col">
  <div class="relative z-10 flex-1">
    <div class="mx-auto space-y-8">
      <!-- Hero Section -->
      <section class="relative space-y-6 py-8 rounded-lg overflow-hidden">
        <div class="absolute inset-0 -z-10 overflow-hidden blur-3xl">
          <div class="absolute -top-4 -right-4 w-96 h-72 bg-[#00DC82]/10 rounded-full"></div>
          <div class="absolute -bottom-4 -left-4 w-96 h-72 bg-[#00DC82]/10 rounded-full"></div>
        </div>

        <div class="space-y-2">
          <p
            class="text-lg font-space-grotesk text-gray-600 dark:text-gray-400 font-medium tracking-wide w-full text-center">
            Welcome to
          </p>
          <h1
            class="font-space-grotesk text-6xl font-bold bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-transparent tracking-tight w-full text-center">
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
              class="feature-card group p-6 rounded-lg transition-all border border-gray-200 dark:border-surface-700/20 hover:shadow-lg hover:scale-[1.02] bg-white dark:bg-[#202633]">
              <div class="relative">
                <div class="absolute inset-0 rounded-lg transition-colors -z-10"></div>
                <i class="fas {feature.icon} text-[#00DC82] mb-4 text-4xl group-hover:scale-110 transition-transform"
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
            <div class="card p-6 transition-all">
              <div class="grid md:grid-cols-2 gap-6">
                <!-- Visual Preview -->
                <div class="flex items-center justify-center p-4 rounded-lg">
                  {#if example.title === 'Get Token Image'}
                    <div class="flex gap-4 items-center">
                      <img
                        src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
                        alt="WBTC Token"
                        class="w-12 h-12 rounded-full" />
                      <i class="fas fa-arrow-right text-[#00DC82]"></i>
                      <div class="text-sm font-mono bg-surface-700/20 p-2 rounded">
                        {example.displayUrl}
                      </div>
                    </div>
                  {:else if example.title === 'Get Network Logo'}
                    <div class="flex gap-4 items-center">
                      <img src={getApiUrl('/image/1')} alt="Ethereum" class="w-12 h-12 rounded-full" />
                      <i class="fas fa-arrow-right text-[#00DC82]"></i>
                      <div class="text-sm font-mono bg-surface-700/20 p-2 rounded">
                        {example.displayUrl}
                      </div>
                    </div>
                  {:else}
                    <div class="flex gap-4 items-center">
                      <div class="flex -space-x-4">
                        <img
                          src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
                          alt="Token 1"
                          class="w-12 h-12 rounded-full border-2 border-surface-700/20" />
                        <img
                          src={getApiUrl('/image/1/0x6B175474E89094C44Da98b954EedeAC495271d0F')}
                          alt="Token 2"
                          class="w-12 h-12 rounded-full border-2 border-surface-700/20" />
                        <img
                          src={getApiUrl('/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')}
                          alt="Token 3"
                          class="w-12 h-12 rounded-full border-2 border-surface-700/20" />
                      </div>
                      <i class="fas fa-arrow-right text-[#00DC82]"></i>
                      <div class="text-sm font-mono bg-surface-700/20 p-2 rounded">
                        {example.displayUrl}
                      </div>
                    </div>
                  {/if}
                </div>

                <!-- Description -->
                <div class="space-y-4">
                  <div class="flex items-center gap-4">
                    <div class="p-3 rounded-lg bg-[#00DC82]/10">
                      <i class="fas {example.icon} text-[#00DC82] text-2xl"></i>
                    </div>
                    <h3 class="h3 font-bold">{example.title}</h3>
                  </div>
                  <p class="text-gray-600 dark:text-gray-300">{example.description}</p>
                  <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                    <i class="fas fa-link text-[#00DC82]"></i>
                    <code class="font-mono break-all">{example.code}</code>
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
            class="metric-card group hover:shadow-lg hover:shadow-[#00DC82]/5 transition-all p-6 rounded-lg border border-gray-200 dark:border-surface-700/20 bg-white dark:bg-[#202633]">
            {#if $metrics}
              <span
                class="block text-5xl font-bold text-center mb-2 bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-transparent">
                {$metrics.tokenList.total}+
              </span>
            {:else}
              <span class="block text-5xl font-bold text-center mb-2 animate-pulse">---</span>
            {/if}
            <p class="text-lg text-center text-gray-600 dark:text-gray-300">Total Tokens</p>
          </div>
          <div
            class="metric-card group hover:shadow-lg hover:shadow-[#00DC82]/5 transition-all p-6 rounded-lg border border-gray-200 dark:border-surface-700/20 bg-white dark:bg-[#202633]">
            {#if $metrics}
              <span
                class="block text-5xl font-bold text-center mb-2 bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-transparent">
                {$metrics.networks.supported.length}
              </span>
            {:else}
              <span class="block text-5xl font-bold text-center mb-2 animate-pulse">---</span>
            {/if}
            <p class="text-lg text-center text-gray-600 dark:text-gray-300">Supported Networks</p>
          </div>
        </div>

        <!-- Token Distribution Graph -->
        {#if $metrics}
          {@const c = console.log($metrics)}
          <div class="card p-4">
            <h3 class="h3 mb-2 text-center">Tokens by Chain</h3>
            <div class="flex h-[400px] flex-col justify-end space-y-3 mt-4 w-full">
              {#each $metrics.networks.supported.filter((n) => n.chainId !== 943) as network}
                {@const tokenCount = $metrics.tokenList.byChain[network.chainId] || 0}
                {@const maxTokens = Math.max(...Object.values($metrics.tokenList.byChain))}
                {@const percentage = (tokenCount / maxTokens) * 100}
                <div class="flex items-center gap-4">
                  <div class="w-32 text-sm font-medium text-gray-900 dark:text-white">
                    {network.name}
                  </div>
                  <div class="flex-1">
                    <div
                      class="chart-bar bg-[#00DC82]/80 hover:bg-[#00DC82] rounded-sm h-8 transition-all duration-300"
                      style="width: {percentage}%">
                      <div class="px-3 text-sm leading-8 font-medium text-black dark:text-white">
                        {tokenCount.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
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
      <section class="card space-y-4 p-8 text-center mb-8">
        <h2 class="h2">Ready to Get Started?</h2>
        <p class="text-lg">Try our URL wizard to generate the perfect integration for your needs.</p>
        <a href="./wizard" class="btn bg-[#00DC82] text-black">
          <i class="fas fa-hat-wizard mr-2"></i>
          Wizard
        </a>
      </section>
    </div>
  </div>

  <!-- Update the floating images container -->
  <div class="absolute inset-0 pointer-events-none overflow-hidden" style="z-index: 1; height: {pageHeight}px;">
    {#each floatingImages as image}
      <div
        class="absolute rounded-full animate-float"
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
        <img
          src={image.type === 'network'
            ? getApiUrl(`/image/${image.chainId}`)
            : getApiUrl(`/image/${image.chainId}/${image.address}`)}
          alt={image.type === 'network' ? 'Network icon' : 'Token icon'}
          class="w-full h-full rounded-full opacity-10"
          on:error={(e) => {
            const target = e.target as HTMLImageElement
            target.src = fallbackIcon
          }} />
      </div>
    {/each}
  </div>
</div>

<style lang="postcss">
  .gradient-heading {
    @apply from-primary-500 to-secondary-500 bg-gradient-to-br bg-clip-text font-bold text-transparent;
  }

  @keyframes float-right {
    0% {
      opacity: 0;
      transform: translateX(-100px) rotate(0deg);
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
      transform: translateX(0) rotate(360deg);
    }
    5% {
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

  /* Update depth and opacity based on layers */
  .animate-float[style*="layer: 'back'"] img {
    opacity: 0.2;
    filter: blur(2px);
  }

  .animate-float[style*="layer: 'middle'"] img {
    opacity: 0.2;
    filter: blur(1px);
  }

  .animate-float[style*="layer: 'front'"] img {
    opacity: 0.2;
    filter: blur(0);
  }

  /* Hover effects */
  .animate-float:hover img {
    opacity: 0.4;
    filter: blur(0) !important;
    transition: all 0.3s ease;
  }
</style>
