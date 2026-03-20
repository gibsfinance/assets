import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import CodeBlock from '../components/CodeBlock'
import DocsSidebar, { type DocsSidebarSection } from '../components/DocsSidebar'
import EndpointCard from '../components/EndpointCard'
import FrameworkSwitcher from '../components/FrameworkSwitcher'
import { getApiUrl } from '../utils'

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const apiBase = getApiUrl('')

const SECTIONS: DocsSidebarSection[] = [
  { id: 'token-endpoints', label: 'Token Endpoints' },
  { id: 'image-endpoints', label: 'Image Endpoints' },
  { id: 'features', label: 'Features' },
  { id: 'code-examples', label: 'Code Examples' },
]

const TOKEN_ENDPOINTS = [
  {
    method: 'GET',
    path: '/token/{chainId}/{tokenAddress}',
    description: 'Get specific token information',
    example: getApiUrl('/token/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
  },
  {
    method: 'GET',
    path: '/list/',
    description: 'Get all available token lists across providers and chains',
    example: getApiUrl('/list/'),
  },
  {
    method: 'GET',
    path: '/list/{providerKey}/{listKey}',
    description: 'Get a specific token list (e.g. uniswap/hosted, pulsex/extended)',
    example: getApiUrl('/list/pulsex/extended'),
  },
  {
    method: 'GET',
    path: '/list/{providerKey}/{listKey}?chainId={chainId}',
    description: 'Get a filtered token list for a specific chain',
    example: getApiUrl('/list/pulsex/extended?chainId=369'),
  },
]

const IMAGE_ENDPOINTS = [
  {
    method: 'GET',
    path: '/image/{chainId}',
    description: 'Get network/chain images',
    example: getApiUrl('/image/1'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{tokenAddress}',
    description: 'Get token images — priority-ordered fallback chain',
    example: getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
  },
  {
    method: 'GET',
    path: '/image/fallback/{order}/{chainId}/{tokenAddress}',
    description: 'Get token icon with explicit fallback order',
    example: getApiUrl('/image/fallback/default/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
  },
  {
    method: 'GET',
    path: '/image/direct/{hash}',
    description: 'Get image by content hash — direct content-addressed access',
  },
]

const FEATURES = [
  {
    icon: 'fa-coins',
    title: 'Token Management',
    items: ['Token list management', 'Token data aggregation', 'Token statistics tracking'],
  },
  {
    icon: 'fa-image',
    title: 'Image Handling',
    items: ['Token image serving and caching', 'Network/chain images', 'Fallback mechanisms'],
  },
  {
    icon: 'fa-network-wired',
    title: 'Network Support',
    items: ['Multiple blockchain networks', 'Chain-specific data', 'Cross-chain compatibility'],
  },
  {
    icon: 'fa-database',
    title: 'Data Management',
    items: ['Database operations', 'Configuration management', 'Efficient caching'],
  },
]

const CODE_LANGUAGES = [
  { key: 'html', label: 'HTML' },
  { key: 'javascript', label: 'JavaScript' },
  { key: 'react', label: 'React' },
  { key: 'curl', label: 'cURL' },
]

const CODE_EXAMPLES: Record<string, { code: string; lang: 'html' | 'js' | 'console' }> = {
  html: {
    lang: 'html',
    code: `<!-- Token image — WBTC on Ethereum -->
<img src="${apiBase}/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" alt="WBTC" />

<!-- Network image — Ethereum -->
<img src="${apiBase}/image/1" alt="Ethereum" />`,
  },
  javascript: {
    lang: 'js',
    code: `// Get a token image (e.g. WBTC on Ethereum)
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
    });`,
  },
  react: {
    lang: 'js',
    code: `import { useState, useEffect } from 'react'

const API_BASE = '${apiBase}'

function TokenImage({ chainId, address, alt }) {
  return (
    <img
      src={\`\${API_BASE}/image/\${chainId}/\${address}\`}
      alt={alt}
      onError={(e) => {
        e.currentTarget.src = '/fallback-token.png'
      }}
    />
  )
}

function useTokenList(providerKey, listKey, chainId) {
  const [tokens, setTokens] = useState([])

  useEffect(() => {
    const params = chainId ? \`?chainId=\${chainId}\` : ''
    fetch(\`\${API_BASE}/list/\${providerKey}/\${listKey}\${params}\`)
      .then(res => res.json())
      .then(data => setTokens(data.tokens ?? []))
  }, [providerKey, listKey, chainId])

  return tokens
}

// Usage
function App() {
  const tokens = useTokenList('pulsex', 'extended', 369)
  return (
    <ul>
      {tokens.map(token => (
        <li key={token.address}>
          <TokenImage chainId={token.chainId} address={token.address} alt={token.name} />
          {token.symbol}
        </li>
      ))}
    </ul>
  )
}`,
  },
  curl: {
    lang: 'console',
    code: `# Get a token image (WBTC on Ethereum)
curl -o wbtc.png "${apiBase}/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"

# Get all token lists
curl "${apiBase}/list" | jq .

# Get a specific list
curl "${apiBase}/list/pulsex/extended" | jq .tokens[0]

# Get tokens for a specific chain
curl "${apiBase}/list/pulsex/extended?chainId=369" | jq .

# Get network icon (Ethereum)
curl -o ethereum.png "${apiBase}/image/1"`,
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterEndpoints<T extends { path: string; description: string }>(
  endpoints: T[],
  query: string,
): T[] {
  if (!query.trim()) return endpoints
  const lower = query.toLowerCase()
  return endpoints.filter(
    (e) => e.path.toLowerCase().includes(lower) || e.description.toLowerCase().includes(lower),
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Docs() {
  const [activeSection, setActiveSection] = useState('token-endpoints')
  const [filterQuery, setFilterQuery] = useState('')
  const [activeLanguage, setActiveLanguage] = useState('javascript')

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  // Track which section is visible via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = []

    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return
      sectionRefs.current[id] = el

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveSection(id)
          }
        },
        { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
      )
      observer.observe(el)
      observers.push(observer)
    })

    return () => observers.forEach((o) => o.disconnect())
  }, [])

  const handleSectionChange = useCallback((id: string) => {
    setActiveSection(id)
  }, [])

  const filteredTokenEndpoints = filterEndpoints(TOKEN_ENDPOINTS, filterQuery)
  const filteredImageEndpoints = filterEndpoints(IMAGE_ENDPOINTS, filterQuery)
  const activeExample = CODE_EXAMPLES[activeLanguage] ?? CODE_EXAMPLES.javascript

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <div className="border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
        <div className="container mx-auto max-w-6xl px-6 py-12 text-center">
          <h1 className="font-heading text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
            API <span className="text-gradient-brand">Documentation</span>
          </h1>
          <p className="mt-3 text-lg text-gray-600 dark:text-gray-400">
            Complete reference for the Gib Assets API
          </p>
        </div>
      </div>

      {/* Mobile tab bar — sits above the grid, hidden on desktop */}
      <DocsSidebar
        sections={SECTIONS}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        variant="mobile"
      />

      {/* Main layout */}
      <div className="container mx-auto max-w-6xl px-6 py-10">
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-12">
          {/* Desktop sticky sidebar — hidden on mobile */}
          <DocsSidebar
            sections={SECTIONS}
            activeSection={activeSection}
            onSectionChange={handleSectionChange}
            variant="desktop"
          />

          {/* Main content */}
          <main className="min-w-0 space-y-16 mt-6 lg:mt-0">
            {/* Quick filter */}
            <div className="relative">
              <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400" />
              <input
                type="search"
                placeholder="Filter endpoints…"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                className="w-full rounded-xl border border-border-light dark:border-border-dark bg-surface-light-1 dark:bg-surface-1 py-2.5 pl-9 pr-4 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
            </div>

            {/* Token Endpoints */}
            <section id="token-endpoints" className="scroll-mt-24 space-y-4">
              <h2 className="font-heading text-2xl font-semibold text-gray-900 dark:text-white">
                Token Information Endpoints
              </h2>
              {filteredTokenEndpoints.length > 0 ? (
                <div className="space-y-3">
                  {filteredTokenEndpoints.map((endpoint) => (
                    <EndpointCard key={endpoint.path} {...endpoint} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No endpoints match &ldquo;{filterQuery}&rdquo;.
                </p>
              )}
            </section>

            {/* Image Endpoints */}
            <section id="image-endpoints" className="scroll-mt-24 space-y-4">
              <h2 className="font-heading text-2xl font-semibold text-gray-900 dark:text-white">
                Image Endpoints
              </h2>
              {filteredImageEndpoints.length > 0 ? (
                <div className="space-y-3">
                  {filteredImageEndpoints.map((endpoint) => (
                    <EndpointCard key={endpoint.path} {...endpoint} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No endpoints match &ldquo;{filterQuery}&rdquo;.
                </p>
              )}
            </section>

            {/* Features */}
            <section id="features" className="scroll-mt-24 space-y-4">
              <h2 className="font-heading text-2xl font-semibold text-gray-900 dark:text-white">
                Features
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {FEATURES.map((feature) => (
                  <div key={feature.title} className="glass-card p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500/10">
                        <i className={`fas ${feature.icon} text-accent-500 text-sm`} />
                      </div>
                      <h3 className="font-heading font-semibold text-gray-900 dark:text-white">
                        {feature.title}
                      </h3>
                    </div>
                    <ul className="space-y-1.5 pl-1">
                      {feature.items.map((item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
                        >
                          <span className="h-1 w-1 rounded-full bg-accent-500 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* Code Examples */}
            <section id="code-examples" className="scroll-mt-24 space-y-4">
              <h2 className="font-heading text-2xl font-semibold text-gray-900 dark:text-white">
                Code Examples
              </h2>
              <div className="glass-card overflow-hidden">
                <div className="flex items-center justify-between border-b border-border-light dark:border-border-dark px-4 py-3">
                  <FrameworkSwitcher
                    languages={CODE_LANGUAGES}
                    activeLanguage={activeLanguage}
                    onSelect={setActiveLanguage}
                  />
                </div>
                <div className="p-4">
                  <CodeBlock
                    code={activeExample.code}
                    lang={activeExample.lang}
                    rounded="rounded-xl"
                    prePadding="[&>pre]:px-4 [&>pre]:py-4 [&>pre]:w-fit"
                  />
                </div>
              </div>
            </section>

            {/* CTA */}
            <div className="flex justify-center pb-8">
              <Link
                to="/wizard"
                className="btn-primary inline-flex items-center gap-2"
              >
                <i className="fas fa-hat-wizard" />
                Try the Wizard
              </Link>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
