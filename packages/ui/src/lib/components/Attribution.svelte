<script lang="ts">
  import { attributionProviders } from '../attribution-providers'
  import { isDark } from '../stores/theme'
</script>

<div class="flex flex-col items-center gap-4">
  <p class="text-sm text-surface-600 dark:text-surface-300 text-center italic">
    Powered by
  </p>

  <div class="flex flex-wrap max-w-sm gap-4 items-center justify-center">
    {#each attributionProviders as provider}
      <a
        href={provider.link}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center justify-center p-2 hover:opacity-75 transition-opacity"
        title={provider.name}
      >
        <img
          src={provider.imageUrl.startsWith('http') ? provider.imageUrl : `/logos/${$isDark ? 'dark' : 'light'}/${provider.imageUrl}`}
          alt={provider.name}
          width={32}
          class="max-h-8 max-w-24 object-contain"
        />
      </a>
    {/each}
  </div>
</div>
