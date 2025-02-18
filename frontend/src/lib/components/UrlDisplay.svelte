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

<div class="card variant-ghost space-y-2 p-4">
  <div class="flex items-center justify-between">
    <span class="label">Generated URL</span>
    <button class="variant-soft btn btn-sm" on:click={copyToClipboard}>
      {#if copied}
        <i class="fas fa-check mr-2"></i>
        Copied!
      {:else}
        <i class="fas fa-copy mr-2"></i>
        Copy
      {/if}
    </button>
  </div>
  <code class="break-all text-sm">{url}</code>
</div>

<style lang="postcss">
  .label {
    @apply text-sm font-medium;
  }
</style>
