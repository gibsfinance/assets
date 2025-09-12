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

<div class="min-h-full overflow-x-hidden bg-gray-950">
  <header class="top-0 z-50 border-b border-gray-200/50 bg-gray-900">
    <nav class="mx-auto p-4">
      <div class="flex items-center justify-between">
        <a
          href="#/"
          class="font-space-grotesk group text-2xl font-bold tracking-tight transition-colors hover:text-secondary-600 dark:text-white">
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
