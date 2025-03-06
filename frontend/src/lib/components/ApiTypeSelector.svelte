<script lang="ts">
  import type { ApiType } from '$lib/types'
  import { createEventDispatcher } from 'svelte'

  export let urlType: ApiType
  export let selectedNetwork: any = null

  const dispatch = createEventDispatcher<{
    reset: void
    select: { type: ApiType }
    loadTokens: void
    generateUrl: void
  }>()

  function selectType(type: ApiType) {
    if (type !== urlType) {
      urlType = type
      dispatch('select', { type })
      dispatch('reset')
      
      if (type === 'token' && selectedNetwork) {
        dispatch('loadTokens')
      } else if (type === 'network' && selectedNetwork) {
        dispatch('generateUrl')
      }
    }
  }
</script>

<div class="space-y-2">
  <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
    <button
      class="btn {urlType === 'token' ? 'variant-filled-primary' : 'variant-ghost'}"
      on:click={() => selectType('token')}>
      <i class="fas fa-coins mr-2"></i>
      Token Icon
    </button>
    <button
      class="btn {urlType === 'network' ? 'variant-filled-primary' : 'variant-ghost'}"
      on:click={() => selectType('network')}>
      <i class="fas fa-network-wired mr-2"></i>
      Network Icon
    </button>
  </div>
</div>

<style>
</style>
