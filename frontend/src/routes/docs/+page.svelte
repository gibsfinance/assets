<script lang="ts">
  const endpoints = {
    tokenInfo: [
      {
        path: '/token/{chainId}/{tokenAddress}',
        description: 'Get specific token information',
      },
      {
        path: '/list',
        description: 'Get all available token lists across providers and chains',
      },
      {
        path: '/list/{providerKey}/{listKey}',
        description: 'Get a specific token list (e.g. uniswap/hosted, pulsex/extended)',
      },
      {
        path: '/list/{providerKey}/{listKey}?chainId={chainId}',
        description: 'Get a filtered token list for a specific chain',
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

// Example 2: Get all available token lists
fetch('https://gib.show/list')
    .then(res => res.json())
    .then(lists => {
        // Lists contain information about available token lists:
        // - key: List identifier
        // - name: Display name
        // - providerKey: Provider identifier
        // - chainId: Chain specific lists (0 for global lists)
        // - default: Whether it's a default list
        console.log(lists);
    });

// Example 3: Get tokens from a specific list
fetch('https://gib.show/list/pulsex/extended')
    .then(res => res.json())
    .then(data => {
        // Use the token list data
        console.log(data.tokens);
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

<div class="container mx-auto max-w-4xl space-y-12 p-8">
  <div class="space-y-4 text-center">
    <h1 class="h1">API Documentation</h1>
    <p class="text-lg">Complete reference for the Gib Assets API</p>
  </div>

  <!-- Token Information Endpoints -->
  <section class="space-y-6">
    <h2 class="h2">Token Information Endpoints</h2>
    <div class="card variant-ghost">
      <div class="space-y-4 p-4">
        {#each endpoints.tokenInfo as endpoint}
          <div class="card variant-soft p-4">
            <div class="flex flex-col gap-2">
              <code class="font-mono text-lg text-primary-500">
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
      <div class="space-y-4 p-4">
        {#each endpoints.imageEndpoints as endpoint}
          <div class="card variant-soft p-4">
            <div class="flex flex-col gap-2">
              <code class="font-mono text-lg text-primary-500">
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
    <div class="grid gap-4 md:grid-cols-2">
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Token Management</h3>
        <ul class="list-inside list-disc space-y-2">
          <li>Token list management</li>
          <li>Token data aggregation</li>
          <li>Token statistics tracking</li>
        </ul>
      </div>
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Image Handling</h3>
        <ul class="list-inside list-disc space-y-2">
          <li>Token image serving and caching</li>
          <li>Network/chain images</li>
          <li>Fallback mechanisms</li>
        </ul>
      </div>
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Network Support</h3>
        <ul class="list-inside list-disc space-y-2">
          <li>Multiple blockchain networks</li>
          <li>Chain-specific data</li>
          <li>Cross-chain compatibility</li>
        </ul>
      </div>
      <div class="card variant-soft p-4">
        <h3 class="h3 mb-2">Data Management</h3>
        <ul class="list-inside list-disc space-y-2">
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
      <pre class="overflow-x-auto text-sm"><code>{codeExamples}</code></pre>
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
