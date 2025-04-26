<script lang="ts">
  type Props = {
    address: string
    oninput: (addr: string) => void
    onback: () => void
  }
  const { oninput, onback, address }: Props = $props()

  let tokenAddress = $state('')
  $effect(() => {
    tokenAddress = address
  })

  function handleInput(e: Event) {
    const input = e.target as HTMLInputElement
    tokenAddress = input.value.trim()
    oninput(tokenAddress)
  }
</script>

<div class="space-y-2">
  <div class="flex items-center justify-between">
    <label for="token-address" class="label">Token Address</label>
    <button class="variant-filled-primary btn btn-sm" onclick={onback}>
      <i class="fas fa-arrow-left mr-2"></i>
      Back to Token Browser
    </button>
  </div>
  <input id="token-address" type="text" class="input" placeholder="0x..." value={tokenAddress} oninput={handleInput} />
</div>
<!--
<style lang="postcss">
  @references '../../app.css';
  .label {
    @apply text-sm font-medium;
  }
</style> -->
