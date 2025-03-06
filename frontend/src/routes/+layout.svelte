<script lang="ts">
  import { goto } from '$app/navigation'
  import ThemeToggle from '$lib/components/ThemeToggle.svelte'
  import '../app.css'
  import { page } from '$app/stores'

  // Handle base path for IPFS
  if (typeof window !== 'undefined') {
    const updateBasePath = () => {
      const basePath = (window as any).__ipfsPath || ''
      if (basePath && !window.location.pathname.startsWith(basePath)) {
        const newPath = basePath + window.location.pathname
        window.history.replaceState(null, '', newPath)
      }
    }

    // Handle hash-based navigation
    const updateHash = () => {
      const path = window.location.pathname + window.location.search
      if (path !== '/' && !window.location.hash) {
        window.history.replaceState(null, '', '#' + path)
      }
    }

    window.addEventListener('popstate', () => {
      updateBasePath()
      updateHash()
    })

    updateBasePath()
    updateHash()
  }

  // Check if we're on the wizard page
  $: isWizardPage = $page.url.pathname === '/wizard' || $page.url.hash === '#/wizard'
</script>

<div
  class="app min-h-full overflow-x-hidden bg-gradient-to-br from-gray-50 to-gray-100 dark:from-[#1a1f2b] dark:to-[#151821]">
  <header
    class="sticky top-0 z-50 border-b border-gray-200/50 bg-white/70 backdrop-blur-lg dark:border-surface-700/20 dark:bg-[#1a1f2b]/70">
    <nav class="container mx-auto p-4">
      <div class="flex items-center justify-between">
        <a
          href="#/"
          class="font-space-grotesk group text-2xl font-bold tracking-tight transition-colors hover:text-[#00DC82] dark:text-white">
          <span class="transition-colors group-hover:text-[#00DC82]">Gib</span><span class="text-[#00DC82]">.Show</span>
        </a>
        <div class="flex items-center gap-4">
          {#if !isWizardPage}
            <button
              on:click={() => {
                goto('/#/wizard')
              }}
              class="btn bg-[#00DC82] text-black shadow-lg transition-all hover:-translate-y-0.5 hover:bg-[#00DC82]/80">
              <i class="fas fa-hat-wizard mr-2"></i>
              Wizard
            </button>
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

<style lang="postcss">
  :global(.font-space-grotesk) {
    font-family: 'Space Grotesk', sans-serif;
  }

  :global(.dark) {
    --theme-font-color-base: 255 255 255;
    --theme-font-color-dark: 0 0 0;
    --theme-rounded-base: 6px;
    --theme-rounded-container: 8px;
    --theme-bg-base: 26 31 43; /* #1a1f2b - lighter dark background */
    --theme-bg-card: 32 38 51; /* #202633 - lighter card background */
  }

  :global(.dark .card) {
    @apply border border-surface-700/20 bg-[#202633];
  }

  :global(.btn-primary) {
    @apply bg-[#00DC82] text-black hover:bg-[#00DC82]/80;
  }

  :global(.gradient-heading) {
    @apply bg-gradient-to-br from-[#00DC82] to-[#00b368] dark:from-[#00DC82] dark:to-[#00DC82]/70;
  }
</style>
