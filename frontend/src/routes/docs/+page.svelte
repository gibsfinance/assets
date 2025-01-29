<script lang="ts">
  const endpoints = {
    tokenInfo: [
      {
        path: '/token/{chainId}/{tokenAddress}',
        description: 'Get specific token information',
      },
      {
        path: '/list/{listName}',
        description: 'Get full token list (e.g. 9mm list)',
      },
      {
        path: '/list/{listName}?chainId={chainId}',
        description: 'Get filtered token list for specific chain',
      },
      {
        path: '/list/{listName}?chainId={chainId}&address={tokenAddress}',
        description: 'Get token list filtered by chain and address',
      },
    ],
    imageEndpoints: [
      {
        path: '/image/{chainId}',
        description: 'Get network/chain images',
      },
      {
        path: '/image/{chainId}/{tokenAddress}',
        description: 'Get token images',
      },
      {
        path: '/image/fallback/default/{chainId}/{tokenAddress}',
        description: 'Get fallback token images',
      },
      {
        path: '/image/direct/{hash}',
        description: 'Get direct image access via hash',
      },
    ],
  }

  const codeExamples = `// Get a token image (e.g. WBTC on Ethereum)
const baseUrl = window.location.hostname === 'localhost' ? 'https://gib.show' : '';
fetch(\`\${baseUrl}/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599\`)
    .then(response => response.blob())
    .then(blob => {
        const imageUrl = URL.createObjectURL(blob);
        // Use the image URL in an <img> tag
        // <img src={imageUrl} alt="Token logo" />
    });

// Example 2: Get network tokens with filtering
async function getNetworkTokens(chainId: number) {
    const tokens = await fetch(\`https://gib.show/list/default?chainId=\${chainId}\`)
        .then(res => res.json())
        .then(data => data.tokens)
        .catch(error => {
            console.error('Failed to fetch tokens:', error);
            return [];
        });

// Get a specific network icon (e.g. Ethereum)
fetch(\`\${baseUrl}/image/1\`)
    .then(response => response.blob())
    .then(blob => {
        const imageUrl = URL.createObjectURL(blob);
        // Use the network logo
        // <img src={imageUrl} alt="Network logo" />
    });`
</script>

<div class="container mx-auto p-8 max-w-4xl space-y-12">
  <div class="text-center space-y-4">
    <h1 class="h1">API Documentation</h1>
    <p class="text-lg">Complete reference for the Gib Assets API</p>
  </div>

  <!-- Token Information Endpoints -->
  <section class="space-y-6">
    <h2 class="h2">Token Information Endpoints</h2>
    <div class="card variant-ghost">
      <div class="p-4 space-y-4">
        {#each endpoints.tokenInfo as endpoint}
          <div class="card variant-soft p-4">
            <div class="flex flex-col gap-2">
              <code class="text-primary-500 font-mono text-lg">
                {endpoint.path}
              </code>
              <p class="text-sm">{endpoint.description}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- Image Endpoints -->
  <section class="space-y-6">
    <h2 class="h2">Image Endpoints</h2>
    <div class="card variant-ghost">
      <div class="p-4 space-y-4">
        {#each endpoints.imageEndpoints as endpoint}
          <div class="card variant-soft p-4">
            <div class="flex flex-col gap-2">
              <code class="text-primary-500 font-mono text-lg">
                {endpoint.path}
              </code>
              <p class="text-sm">{endpoint.description}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="space-y-6">
    <h2 class="h2">Features</h2>
    <div class="grid md:grid-cols-2 gap-4">
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Token Management</h3>
        <ul class="list-disc list-inside space-y-2">
          <li>Token list management</li>
          <li>Token data aggregation</li>
          <li>Token statistics tracking</li>
        </ul>
      </div>
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Image Handling</h3>
        <ul class="list-disc list-inside space-y-2">
          <li>Token image serving and caching</li>
          <li>Network/chain images</li>
          <li>Fallback mechanisms</li>
        </ul>
      </div>
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Network Support</h3>
        <ul class="list-disc list-inside space-y-2">
          <li>Multiple blockchain networks</li>
          <li>Chain-specific data</li>
          <li>Cross-chain compatibility</li>
        </ul>
      </div>
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Data Management</h3>
        <ul class="list-disc list-inside space-y-2">
          <li>Database operations</li>
          <li>Configuration management</li>
          <li>Efficient caching</li>
        </ul>
      </div>
    </div>
  </section>

  <!-- Example Usage -->
  <section class="space-y-6">
    <h2 class="h2">Example Usage</h2>
    <div class="card variant-ghost p-6">
      <pre class="text-sm overflow-x-auto"><code>{codeExamples}</code></pre>
    </div>
  </section>

  <!-- Try It Out -->
  <div class="text-center">
    <a href="./wizard" class="btn bg-[#00DC82] text-black hover:bg-[#00DC82]/80">
      <i class="fas fa-hat-wizard mr-2"></i>
      Wizard
    </a>
  </div>
</div>
