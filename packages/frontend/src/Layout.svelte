<script lang="ts">
  import ThemeToggle from './lib/components/ThemeToggle.svelte'
  import { page, goto } from './lib/stores/page.svelte'
  import type { Snippet } from 'svelte'

  type Props = {
    children: Snippet
  }
  const { children }: Props = $props()

  // Check if we're on the wizard page
  const isWizardPage = $derived(page.url.pathname === '/wizard' || page.url.hash === '#/wizard')
</script>

<div class="min-h-full overflow-x-hidden bg-surface-950">
  <header class="top-0 z-50 border-b border-gray-200/50 bg-surface-900">
    <nav class="mx-auto p-4">
      <div class="flex items-center justify-between">
        <a
          href="#/"
          class="font-space-grotesk group text-2xl font-bold tracking-tight transition-colors hover:text-secondary-600 darktext-white">
          <span class="transition-colors group-hover:text-secondary-600">Gib</span><span class="text-secondary-600"
            >.Show</span>
        </a>
        <div class="flex items-center gap-4">
          {#if !isWizardPage}
            <button
              onclick={() => {
                goto('#/wizard')
              }}
              class="btn bg-secondary-600 text-black shadow-lg transition-all hover:bg-secondary-600/80">
              <i class="fas fa-hat-wizard mr-2"></i>
              Wizard
            </button>
          {/if}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  </header>

  <main class="mx-auto min-h-screen">
    {@render children?.()}
  </main>
</div>
<!--
<style lang="postcss">
  @references 'tailwindcss';
  :global(.font-space-grotesk) {
    font-family: 'Space Grotesk', sans-serif;
  }

  :global(.dark) {
    --theme-font-color-base: 255 255 255;
    --theme-font-color-dark: 0 0 0;
    --theme-rounded-base: 6px;
    --theme-rounded-container: 8px;
    --theme-bg-base: 26 31 43;
    --theme-bg-card: 32 38 51;
  }
   /* #1a1f2b - lighter dark background */
   /* #202633 - lighter card background */

  :global(.dark .card) {
    @apply border border-surface-700/20 bg-[#202633];
  }

  :global(.btn-primary) {
    @apply bg-secondary-600 text-black hover:bg-secondary-600/80;
  }

  :global(.gradient-heading) {
    @apply bg-gradient-to-br from-secondary-600 to-[#00b368] dark:from-secondary-600 dark:to-secondary-600/70;
  }
</style> -->
