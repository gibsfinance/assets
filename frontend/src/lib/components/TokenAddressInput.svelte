<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let tokenAddress: string = ''

  const dispatch = createEventDispatcher<{
    back: void
    input: { address: string }
  }>()

  function handleInput(e: Event) {
    const input = e.target as HTMLInputElement
    tokenAddress = input.value.trim()
    dispatch('input', { address: tokenAddress })
  }

  function handleBack() {
    dispatch('back')
  }
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between">
    <label for="token-address" class="label">Token Address</label>
    <button class="variant-filled-primary btn btn-sm" on:click={handleBack}>
      <i class="fas fa-arrow-left mr-2"></i>
      Back to Token Browser
    </button>
  </div>
  <input
    id="token-address"
    type="text"
    class="input"
    placeholder="0x..."
    bind:value={tokenAddress}
    on:input={handleInput} />
</div>

<style lang="postcss">
  .label {
    @apply text-sm font-medium;
  }
</style>
