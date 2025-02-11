<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let urlType: 'token' | 'network' = 'token'
  export let chainId: string | number | null = null
  export let networkName: string = ''
  export let tokenAddress: string = ''
  export let generatedUrl: string = ''
  
  const GITHUB_REPO_URL = 'https://github.com/gibsfinance/assets'

  const dispatch = createEventDispatcher<{
    submitIssue: void
  }>()

  function createGithubIssue() {
    // Create the issue URL with pre-filled template values
    const params = new URLSearchParams({
      'template': 'missing-asset.yml',
      'title': `[Missing Asset]: ${urlType === 'token' ? `Token icon for ${tokenAddress}` : `Network icon for ${networkName}`}`,
      'asset-type': urlType === 'token' ? 'Token Icon' : 'Network Icon',
      'network-name': networkName,
      'chain-id': chainId?.toString() || '',
      'token-address': tokenAddress,
      'attempted-url': generatedUrl,
    })

    const issueUrl = `${GITHUB_REPO_URL}/issues/new?${params.toString()}`

    // Open the GitHub issue template in a new tab
    window.open(issueUrl, '_blank')
    dispatch('submitIssue')
  }
</script>

<div class="card variant-ghost-error p-4">
  <div class="flex items-center gap-3">
    <i class="fas fa-exclamation-circle text-error-500"></i>
    <div class="flex-1">
      <p class="font-medium">No icon found</p>
      <p class="text-sm opacity-90">
        There is no {urlType === 'token' ? 'token' : 'network'} icon available for this address yet. You can help by
        <a href="#" class="anchor" on:click|preventDefault={createGithubIssue}>submitting an issue</a>
        or contributing directly to the
        <a href={GITHUB_REPO_URL} class="anchor" target="_blank" rel="noopener">Gib Assets repository</a>.
      </p>
    </div>
  </div>
</div> 