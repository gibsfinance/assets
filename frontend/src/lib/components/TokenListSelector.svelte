<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let availableLists: Array<{
    key: string
    name: string
    providerKey: string
    chainId: string
    type: string
    default: boolean
  }> = []

  export let selectedList: { key: string; providerKey: string } | null = null

  const dispatch = createEventDispatcher<{
    select: { providerKey: string; key: string }
  }>()

  function handleChange() {
    if (selectedList) {
      dispatch('select', {
        providerKey: selectedList.providerKey,
        key: selectedList.key,
      })
    }
  }
</script>

<div class="space-y-2">
  <label for="list-select" class="label">Select Token List</label>
  <select id="list-select" class="select" bind:value={selectedList} on:change={handleChange}>
    <option value={null}>Choose a list...</option>
    {#each availableLists as list}
      <option value={{ key: list.key, providerKey: list.providerKey }}>
        {list.name} ({list.providerKey}/{list.key})
      </option>
    {/each}
  </select>
</div>

<style lang="postcss">
  .label {
    @apply text-sm font-medium;
  }
  .select {
    @apply w-full;
  }
</style>
