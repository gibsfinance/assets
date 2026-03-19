import { Link } from 'react-router-dom'
import CodeBlock from '../components/CodeBlock'
import { getApiUrl } from '../utils'

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

const apiBase = getApiUrl('')

const htmlCodeExamples = `<img src="${apiBase}/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" />`

const codeExamples = `// Get a token image (e.g. WBTC on Ethereum)
fetch(\`${apiBase}/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599\`)
    .then(response => response.blob())
    .then(blob => {
        const imageUrl = URL.createObjectURL(blob);
        // Use the image URL in an <img> tag
        // <img src={imageUrl} alt="Token logo" />
    });

// Example 2: Get all available token lists
fetch('${apiBase}/list')
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
fetch('${apiBase}/list/pulsex/extended')
    .then(res => res.json())
    .then(data => {
        // Use the token list data
        console.log(data.tokens);
    });

// Get a specific network icon (e.g. Ethereum)
fetch(\`${apiBase}/image/1\`)
    .then(response => response.blob())
    .then(blob => {
        const imageUrl = URL.createObjectURL(blob);
        // Use the network logo
        // <img src={imageUrl} alt="Network logo" />
    });`

export default function Docs() {
  return (
    <div className="container mx-auto max-w-4xl space-y-12 p-8">
      <div className="space-y-4 text-center">
        <h1 className="h1">API Documentation</h1>
        <p className="text-lg">Complete reference for the Gib Assets API</p>
      </div>

      {/* Token Information Endpoints */}
      <section className="space-y-6">
        <h2 className="h2">Token Information Endpoints</h2>
        <div className="card variant-ghost">
          <div className="space-y-4 p-4">
            {endpoints.tokenInfo.map((endpoint) => (
              <div key={endpoint.path} className="card variant-soft p-4">
                <div className="flex flex-col gap-2">
                  <CodeBlock code={endpoint.path} />
                  <p className="text-sm">{endpoint.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Image Endpoints */}
      <section className="space-y-6">
        <h2 className="h2">Image Endpoints</h2>
        <div className="card variant-ghost">
          <div className="space-y-4 p-4">
            {endpoints.imageEndpoints.map((endpoint) => (
              <div key={endpoint.path} className="card variant-soft p-4">
                <div className="flex flex-col gap-2">
                  <CodeBlock code={endpoint.path} />
                  <p className="text-sm">{endpoint.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="space-y-6">
        <h2 className="h2">Features</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card variant-soft p-4">
            <h3 className="h3 mb-2">Token Management</h3>
            <ul className="list-inside list-disc space-y-2">
              <li>Token list management</li>
              <li>Token data aggregation</li>
              <li>Token statistics tracking</li>
            </ul>
          </div>
          <div className="card variant-soft p-4">
            <h3 className="h3 mb-2">Image Handling</h3>
            <ul className="list-inside list-disc space-y-2">
              <li>Token image serving and caching</li>
              <li>Network/chain images</li>
              <li>Fallback mechanisms</li>
            </ul>
          </div>
          <div className="card variant-soft p-4">
            <h3 className="h3 mb-2">Network Support</h3>
            <ul className="list-inside list-disc space-y-2">
              <li>Multiple blockchain networks</li>
              <li>Chain-specific data</li>
              <li>Cross-chain compatibility</li>
            </ul>
          </div>
          <div className="card variant-soft p-4">
            <h3 className="h3 mb-2">Data Management</h3>
            <ul className="list-inside list-disc space-y-2">
              <li>Database operations</li>
              <li>Configuration management</li>
              <li>Efficient caching</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Example Usage */}
      <section className="space-y-6">
        <h2 className="h2">Example Usage</h2>
        <div className="card variant-ghost p-6 gap-4 flex flex-col">
          <CodeBlock code={htmlCodeExamples} lang="html" />
          <CodeBlock code={codeExamples} lang="js" />
        </div>
      </section>

      {/* Try It Out */}
      <div className="text-center">
        <Link to="/wizard" className="btn bg-secondary-600 text-black hover:bg-secondary-600/80">
          <i className="fas fa-hat-wizard mr-2"></i>
          Wizard
        </Link>
      </div>
    </div>
  )
}
