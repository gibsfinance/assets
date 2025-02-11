<script lang="ts">
  export let url: string
  let copied = false

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(url)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }
</script>

<div class="card variant-ghost p-4 space-y-2">
  <div class="flex justify-between items-center">
    <span class="label">Generated URL</span>
    <button class="btn btn-sm variant-soft" on:click={copyToClipboard}>
      {#if copied}
        <i class="fas fa-check mr-2"></i>
        Copied!
      {:else}
        <i class="fas fa-copy mr-2"></i>
        Copy
      {/if}
    </button>
  </div>
  <code class="text-sm break-all">{url}</code>
</div>

<style lang="postcss">
  .label {
    @apply font-medium text-sm;
  }
</style> 