<script lang="ts">
  import type { ApiType, NetworkInfo } from '../types'

  type Props = {
    urlType: ApiType
    network: NetworkInfo | null
    onselect: (type: ApiType) => void
    onreset: () => void
    onloadtokens: () => void
    ongenerate: () => void
  }
  const { urlType, network, onselect, onreset, onloadtokens, ongenerate }: Props = $props()
  let t = $state<ApiType>(urlType)
  $effect(() => {
    t = urlType
  })
  const selectType = (type: ApiType) => {
    if (type !== urlType) {
      t = type
      onselect(type)
      onreset()

      if (type === 'token' && network) {
        onloadtokens()
      } else if (type === 'network' && network) {
        ongenerate()
      }
    }
  }
</script>

<div class="space-y-2">
  <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
    <button
      type="button"
      class="btn {urlType === 'token' ? 'variant-filled-primary' : 'variant-ghost'}"
      onclick={() => selectType('token')}>
      <i class="fas fa-coins mr-2"></i>
      Token Icon
    </button>
    <button
      type="button"
      class="btn {urlType === 'network' ? 'variant-filled-primary' : 'variant-ghost'}"
      onclick={() => selectType('network')}>
      <i class="fas fa-network-wired mr-2"></i>
      Network Icon
    </button>
  </div>
</div>
