<script lang="ts">
	import '../app.postcss';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { page } from '$app/stores';

	$: isWizardPage = $page.url.pathname === '/wizard' || $page.url.pathname.endsWith('/wizard/');
</script>

<div class="app min-h-full overflow-x-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1a1f2b] dark:to-[#151821]">
	<header class="sticky top-0 z-50 backdrop-blur-lg bg-white/70 dark:bg-[#1a1f2b]/70 border-b border-gray-200/50 dark:border-surface-700/20">
		<nav class="container mx-auto p-4">
			<div class="flex items-center justify-between">
				<a href="/" class="font-space-grotesk text-2xl font-bold dark:text-white group hover:text-[#00DC82] transition-colors tracking-tight">
					<span class="group-hover:text-[#00DC82] transition-colors">The Gib</span><span class="text-[#00DC82]">.Show</span>
				</a>
				<div class="flex items-center gap-4">
					{#if !isWizardPage}
						<a href="/wizard" class="btn bg-[#00DC82] hover:bg-[#00DC82]/80 text-black shadow-lg hover:shadow-[#00DC82]/25 hover:-translate-y-0.5 transition-all">
							<i class="fas fa-hat-wizard mr-2"></i>
							Wizard
						</a>
					{/if}
					<ThemeToggle />
				</div>
			</div>
		</nav>
	</header>

	<main class="container mx-auto p-4">
		<slot />
	</main>
</div>

<style>
	:global(.font-space-grotesk) {
		font-family: 'Space Grotesk', sans-serif;
	}

	:global(.dark) {
		--theme-font-color-base: 255 255 255;
		--theme-font-color-dark: 0 0 0;
		--theme-rounded-base: 6px;
		--theme-rounded-container: 8px;
		--theme-bg-base: 26 31 43;  /* #1a1f2b - lighter dark background */
		--theme-bg-card: 32 38 51;  /* #202633 - lighter card background */
	}

	:global(.dark .card) {
		@apply bg-[#202633] border border-surface-700/20;
	}

	:global(.btn-primary) {
		@apply bg-[#00DC82] text-black hover:bg-[#00DC82]/80;
	}

	:global(.gradient-heading) {
		@apply dark:from-[#00DC82] dark:to-[#00DC82]/70 from-[#00DC82] to-[#00b368] bg-gradient-to-br;
	}
</style>
