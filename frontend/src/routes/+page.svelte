<script lang="ts">
	import { onMount } from 'svelte';
	import { metrics } from '$lib/stores/metrics';
	import type { PlatformMetrics } from '$lib/types';
	import { getApiUrl } from '$lib/utils';

	let metricsData: PlatformMetrics | null = null;
	let pageHeight: number;
	let tokenAddress = '';

	metrics.subscribe((value) => {
		metricsData = value;
	});

	onMount(() => {
		metrics.fetchMetrics();
		pageHeight = document.documentElement.scrollHeight;
		window.addEventListener('resize', () => {
			pageHeight = document.documentElement.scrollHeight;
		});
	});

	// Define features data
	const features = [
		{
			icon: 'fa-cloud',
			title: 'Always Available',
			description: 'Decentralized storage ensures your token assets are always accessible. No more missing images or failed requests.'
		},
		{
			icon: 'fa-bolt',
			title: 'Lightning Fast',
			description: 'Optimized delivery with global CDN and efficient caching. Get token data in milliseconds.'
		},
		{
			icon: 'fa-shield',
			title: 'Reliable & Secure',
			description: 'Verified token data from trusted sources. No more scam tokens or incorrect metadata.'
		}
	];

	// Define examples data
	const examples = [
		{
			icon: 'fa-image',
			title: 'Get Token Image',
			description: 'Fetch token logo for any token on any supported chain. Automatically handles fallback assets.',
			code: getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
			displayUrl: '#/image/1/0x2260...'
		},
		{
			icon: 'fa-network-wired',
			title: 'Get Network Logo',
			description: 'Get chain/network logos and metadata. Perfect for network selectors.',
			code: getApiUrl('/image/1'),
			displayUrl: '#/image/1'
		},
		{
			icon: 'fa-list',
			title: 'Get Token List',
			description: 'Get curated token lists with optional network filtering.',
			code: getApiUrl('/list/default'),
			displayUrl: '#/list/default'
		}
	];

	// Update the floating images data
	const shouldShowMonster = Math.random() < 0.04; // 4% chance (1 in 25)

	const floatingImages = [
		// Far background (small and slow)
		{ type: 'network', chainId: 1, size: 24, speed: 80, delay: 0, direction: 1, layer: 'back', startPos: Math.random() * 100 }, // Ethereum
		{ type: 'network', chainId: 56, size: 20, speed: 90, delay: 15, direction: 1, layer: 'back', startPos: Math.random() * 100 },
		{ type: 'network', chainId: 369, size: 28, speed: 85, delay: 8, direction: 1, layer: 'back', startPos: Math.random() * 100 }, // PulseChain
		
		// Middle layer
		{ type: 'token', chainId: 369, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', size: 48, speed: 70, delay: 5, direction: -1, layer: 'middle', startPos: Math.random() * 100 },
		{ type: 'network', chainId: 324, size: 44, speed: 75, delay: 12, direction: 1, layer: 'middle', startPos: Math.random() * 100 }, // zkSync
		{ type: 'network', chainId: 137, size: 40, speed: 70, delay: 10, direction: 1, layer: 'middle', startPos: Math.random() * 100 }, // Ethereum
		
		// Foreground (large and faster)
		{ type: 'token', chainId: 369, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', size: 72, speed: 60, delay: 10, direction: 1, layer: 'front', startPos: Math.random() * 100 },
		{ type: 'network', chainId: 1, size: 68, speed: 65, delay: 18, direction: 1, layer: 'front', startPos: Math.random() * 100 }, // Ethereum
		{ type: 'network', chainId: 42161, size: 55, speed: 55, delay: 25, direction: 1, layer: 'front', startPos: Math.random() * 100 }, // Arbitrum

		// Monster Foreground (only added sometimes)
		...(shouldShowMonster ? [{
			type: 'network',
			chainId: 1,
			size: 168,
			speed: 65,
			delay: 18,
			direction: -1,
			layer: 'front',
			startPos: Math.random() * 125
		}] : [])
	];

	function handleAddressInput(event: Event) {
		const input = event.target as HTMLInputElement;
		// Trim whitespace from the input value
		input.value = input.value.trim();
		tokenAddress = input.value;
	}

	function getTokenUrl(token: Token): string {
		const baseUrl = getApiUrl();
		return `${baseUrl}/image/${token.chainId}/${token.address}`;
	}
</script>

<div class="min-h-screen flex flex-col">
	<div class="relative z-10 flex-1">
		<div class="container mx-auto space-y-8 p-8">
			<!-- Hero Section -->
			<section class="relative space-y-6 py-8">
				<div class="absolute inset-0 -z-10 overflow-hidden">
					<div class="absolute -top-4 -right-4 w-72 h-72 bg-[#00DC82]/10 rounded-full blur-3xl"></div>
					<div class="absolute -bottom-4 -left-4 w-72 h-72 bg-[#00DC82]/10 rounded-full blur-3xl"></div>
				</div>

				<div class="space-y-2">
					<p class="text-lg font-space-grotesk text-gray-600 dark:text-gray-400 font-medium tracking-wide">
						Welcome to
					</p>
					<h1 class="font-space-grotesk text-6xl font-bold bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-transparent tracking-tight">
						The Gib<span class="text-[#00DC82]">.Show</span>
					</h1>
				</div>
				
				<p class="mx-auto max-w-3xl text-xl font-medium text-gray-600 dark:text-gray-400">
					A decentralized solution for token metadata and assets across multiple blockchains. Stop
					struggling with missing logos, broken images, and inconsistent token data. One API to handle
					all your token asset needs.
				</p>
			</section>

			<!-- Features Grid -->
			<section class="space-y-8 py-8">
				<h2 class="h2 text-center text-3xl font-bold">Why Use Gib Assets?</h2>
				<div class="grid grid-cols-1 gap-6 md:grid-cols-3">
					{#each features as feature}
						<div class="feature-card group">
							<div class="relative">
								<div class="absolute inset-0 bg-[#00DC82]/5 group-hover:bg-[#00DC82]/10 rounded-lg transition-colors -z-10"></div>
								<i class="fas {feature.icon} text-[#00DC82] mb-4 text-4xl group-hover:scale-110 transition-transform"></i>
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
						<div class="card p-6 hover:shadow-lg hover:shadow-[#00DC82]/5 transition-all">
							<div class="grid md:grid-cols-2 gap-6">
								<!-- Visual Preview -->
								<div class="flex items-center justify-center p-4 bg-surface-700/10 rounded-lg">
									{#if example.title === 'Get Token Image'}
										<div class="flex gap-4 items-center">
											<img 
												src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')} 
												alt="WBTC Token" 
												class="w-12 h-12 rounded-full"
											/>
											<i class="fas fa-arrow-right text-[#00DC82]"></i>
											<div class="text-sm font-mono bg-surface-700/20 p-2 rounded">
												{example.displayUrl}
											</div>
										</div>
									{:else if example.title === 'Get Network Logo'}
										<div class="flex gap-4 items-center">
											<img 
												src={getApiUrl('/image/1')} 
												alt="Ethereum" 
												class="w-12 h-12 rounded-full"
											/>
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
													class="w-12 h-12 rounded-full border-2 border-surface-700/20"
												/>
												<img 
													src={getApiUrl('/image/1/0x6B175474E89094C44Da98b954EedeAC495271d0F')} 
													alt="Token 2" 
													class="w-12 h-12 rounded-full border-2 border-surface-700/20"
												/>
												<img 
													src={getApiUrl('/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')} 
													alt="Token 3" 
													class="w-12 h-12 rounded-full border-2 border-surface-700/20"
												/>
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
					<div class="metric-card group hover:shadow-lg hover:shadow-[#00DC82]/5 transition-all">
						{#if $metrics}
							<span class="block text-5xl font-bold text-center mb-2 bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-transparent">
								{$metrics.tokenList.total}+
							</span>
						{:else}
							<span class="block text-5xl font-bold text-center mb-2 animate-pulse">---</span>
						{/if}
						<p class="text-lg text-center text-gray-600 dark:text-gray-300">Total Tokens</p>
					</div>
					<div class="metric-card group hover:shadow-lg hover:shadow-[#00DC82]/5 transition-all">
						{#if $metrics}
							<span class="block text-5xl font-bold text-center mb-2 bg-gradient-to-r from-[#00DC82] to-[#00b368] bg-clip-text text-transparent">
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
					<div class="card p-4">
						<h3 class="h3 mb-2 text-center">Tokens by Chain</h3>
						<div class="flex h-[400px] flex-col justify-end space-y-3 mt-4">
							{#each $metrics.networks.supported.filter(n => n.chainId !== 943) as network}
								{@const tokenCount = $metrics.tokenList.byChain[network.chainId] || 0}
								{@const maxTokens = Math.max(...Object.values($metrics.tokenList.byChain))}
								{@const percentage = (tokenCount / maxTokens) * 100}
								<div class="flex items-center gap-4">
									<div class="w-32 text-sm font-medium text-gray-900 dark:text-white">
										{network.name}
									</div>
									<div class="flex-1">
										<div 
											class="chart-bar"
											style="width: {percentage}%"
										>
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
				<a href="./wizard" class="btn bg-[#00DC82] text-black hover:bg-[#00DC82]/80">
					<i class="fas fa-hat-wizard mr-2"></i>
					Wizard
				</a>
			</section>
		</div>
	</div>

	<!-- Replace the floating images container -->
	<div class="absolute inset-0 pointer-events-none" style="z-index: 1; height: {pageHeight}px;">
		{#each floatingImages as image}
			<div
				class="absolute rounded-full animate-float"
				style="
					width: {image.size}px;
					height: {image.size}px;
					animation-duration: {image.speed}s;
					animation-delay: {image.delay}s;
					top: {Math.random() * pageHeight}px;
					left: {Math.random() * 100}vw;
					opacity: 0;
				"
			>
				<img
					src={image.type === 'network' 
						? getApiUrl(`/image/${image.chainId}`) 
						: getApiUrl(`/image/${image.chainId}/${image.address}`)}
					alt={image.type === 'network' ? 'Network icon' : 'Token icon'}
					class="w-full h-full rounded-full opacity-10"
					on:error={(e) => {
						const target = e.target as HTMLImageElement;
						target.src = fallbackIcon;
					}}
				/>
			</div>
		{/each}
	</div>
</div>

<style>
	.gradient-heading {
		@apply from-primary-500 to-secondary-500 bg-gradient-to-br bg-clip-text font-bold text-transparent;
	}

	@keyframes float-right {
		0% {
			opacity: 0;
			transform: translate(-50vw, 0) rotate(0deg);
		}
		5% {
			opacity: 1;
		}
		95% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(150vw, 0) rotate(360deg);
		}
	}

	@keyframes float-left {
		0% {
			opacity: 0;
			transform: translate(150vw, 0) rotate(360deg);
		}
		5% {
			opacity: 1;
		}
		95% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(-50vw, 0) rotate(0deg);
		}
	}

	.animate-float {
		animation: float-right var(--duration, 20s) linear infinite;
		will-change: transform, opacity;
	}

	.animate-float[style*="direction: -1"] {
		animation-name: float-left;
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

	/* Handle browser autofill styling */
	input:-webkit-autofill,
	input:-webkit-autofill:hover,
	input:-webkit-autofill:focus {
		-webkit-text-fill-color: rgb(156 163 175); /* gray-400 */
		-webkit-box-shadow: 0 0 0px 1000px rgb(17 24 39) inset; /* dark gray-900 */
		transition: background-color 5000s ease-in-out 0s;
	}

	:global(.dark) input:-webkit-autofill,
	:global(.dark) input:-webkit-autofill:hover,
	:global(.dark) input:-webkit-autofill:focus {
		-webkit-text-fill-color: rgb(156 163 175); /* gray-400 */
		-webkit-box-shadow: 0 0 0px 1000px rgb(17 24 39) inset; /* dark gray-900 */
	}
</style>
