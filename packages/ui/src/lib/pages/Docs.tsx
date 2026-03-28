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
    path: '/list/',
    description: 'Get all available token lists. Filter with ?key=, ?provider_key=, ?chain_id=, ?chain_type=, ?default=',
    example: getApiUrl('/list/'),
  },
  {
    method: 'GET',
    path: '/list/tokens/{chainId}',
    description: 'All deduplicated tokens for a chain, ranked by list priority. Supports ?limit= (default 50k, max 100k), ?extensions=bridgeInfo, ?decimals=',
    example: getApiUrl('/list/tokens/369'),
  },
  {
    method: 'GET',
    path: '/list/tokens/{chainId}?limit={limit}',
    description: 'Limit the number of tokens returned',
    example: getApiUrl('/list/tokens/369?limit=20'),
  },
  {
    method: 'GET',
    path: '/list/tokens/{chainId}?decimals={decimals}',
    description: 'Filter tokens by decimals (can be comma-separated)',
    example: getApiUrl('/list/tokens/369?decimals=18'),
  },
  {
    method: 'GET',
    path: '/list/merged/{order}',
    description: 'Merged token list using a named ordering. Supports ?extensions=bridgeInfo|headerUri|sansMetadata, ?chainId=, ?decimals=',
    example: getApiUrl('/list/merged/default'),
  },
  {
    method: 'GET',
    path: '/list/{providerKey}/{listKey}',
    description: 'A specific token list. Supports ?chainId=, ?decimals=, ?extensions=',
    example: getApiUrl('/list/pulsex/extended'),
  },
  {
    method: 'GET',
    path: '/list/{providerKey}/{listKey}?chainId={chainId}',
    description: 'Filter a token list to a specific chain',
    example: getApiUrl('/list/pulsex/extended?chainId=369'),
  },
  {
    method: 'GET',
    path: '/list/{providerKey}/{listKey}/{version}',
    description: 'A specific versioned token list (e.g. 1.0.2)',
    example: getApiUrl('/list/pulsex/extended/1.0.0'),
  },
  {
    method: 'GET',
    path: '/networks',
    description: 'All supported networks with chain IDs',
    example: getApiUrl('/networks'),
  },
  {
    method: 'GET',
    path: '/stats',
    description: 'Per-chain token counts (distinct addresses)',
    example: getApiUrl('/stats'),
  },
]

const IMAGE_ENDPOINTS = [
  {
    method: 'GET',
    path: '/image/{chainId}',
    description: 'Network/chain icon. Supports ?only=vector|raster to filter source format',
    example: getApiUrl('/image/369'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}',
    description: 'Token image — priority-ordered by list ranking. Supports ?as=, ?only=, ?mode=, ?providerKey=, ?listKey=, ?w=, ?h=',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}.{ext}',
    description: 'Convert to a specific output format: .png, .webp, .jpg, .avif. SVG source required for .svg output',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.webp'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}?only={type}',
    description: 'Filter source by type: vector (SVG/XML only) or raster (PNG/JPG/WebP/GIF only)',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?only=vector'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}?as={format}',
    description: 'Convert output to a specific format: webp, png, jpg, avif',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?as=webp'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}?w={width}&h={height}',
    description: 'Resize image on the fly (1-2048px). Combine with ?as= for output conversion',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?w=64&h=64'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}?mode=link',
    description: 'Redirect to the original image URI instead of serving content',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?mode=link'),
  },
  {
    method: 'GET',
    path: '/image/{chainId}/{address}?providerKey={key}&listKey={key}',
    description: 'Filter to images from specific providers or lists',
    example: getApiUrl('/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?providerKey=pulsex'),
  },
  {
    method: 'GET',
    path: '/image/{order}/{chainId}/{address}',
    description: 'Token image with explicit provider ordering',
    example: getApiUrl('/image/default/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27'),
  },
  {
    method: 'GET',
    path: '/image/fallback/{order}/{chainId}/{address}',
    description: 'Tries ordered lookup first, falls back to unordered',
    example: getApiUrl('/image/fallback/default/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27'),
  },
  {
    method: 'GET',
    path: '/image/direct/{hash}.{ext}',
    description: 'Image by content hash — direct content-addressed access',
  },
  {
    method: 'GET',
    path: '/image/?i={chainId}/{address}',
    description: 'Batch lookup — try multiple tokens, return first match. Accepts repeated i= params',
    example: getApiUrl('/image/?i=369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27'),
  },
  {
    method: 'GET',
    path: '/sprite/{providerKey}/{listKey}',
    description: 'Sprite sheet manifest (JSON). Supports ?size= (16-128), ?cols= (5-50), ?limit= (max 2000), ?chainId=, ?content=mixed',
    example: getApiUrl('/sprite/pulsex/extended'),
  },
  {
    method: 'GET',
    path: '/sprite/{providerKey}/{listKey}/sheet',
    description: 'Rendered sprite sheet image (WebP). Same params as manifest',
    example: getApiUrl('/sprite/pulsex/extended/sheet?size=32&cols=10&limit=20'),
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
    code: `<!-- Token image — WPLS on PulseChain (original format) -->
<img src="${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27" alt="WPLS" />

<!-- Same image converted to WebP (smaller file) -->
<img src="${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.webp" alt="WPLS" />

<!-- Resized to 64x64 as WebP -->
<img src="${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?w=64&h=64&as=webp" alt="WPLS" />

<!-- Network icon — PulseChain -->
<img src="${apiBase}/image/369" alt="PulseChain" />`,
  },
  javascript: {
    lang: 'js',
    code: `// Get all tokens for PulseChain, ranked by list priority
const res = await fetch('${apiBase}/list/tokens/369?limit=100')
const { tokens, total } = await res.json()
// tokens[0] = highest priority token (from PulseX list)
// each token has .sources[] showing which lists include it

// Get a token image as WebP
const img = await fetch('${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?as=webp')
const blob = await img.blob()
const url = URL.createObjectURL(blob)

// Filter to only vector (SVG) sources
const svg = await fetch('${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?only=vector')
// 404 if no SVG exists, 200 with SVG content if it does

// Get tokens from a specific provider list
const list = await fetch('${apiBase}/list/pulsex/extended?chainId=369')
const data = await list.json()
console.log(data.tokens.length, 'tokens')`,
  },
  react: {
    lang: 'js',
    code: `import { useState, useEffect } from 'react'

const API = '${apiBase}'

// Token image with optional format conversion
function TokenImage({ chainId, address, alt, as }) {
  const ext = as ? \`.\${as}\` : ''
  return (
    <img
      src={\`\${API}/image/\${chainId}/\${address}\${ext}\`}
      alt={alt}
      onError={(e) => { e.currentTarget.style.display = 'none' }}
    />
  )
}

// Fetch ranked tokens for a chain
function useChainTokens(chainId) {
  const [tokens, setTokens] = useState([])
  useEffect(() => {
    if (!chainId) return
    fetch(\`\${API}/list/tokens/\${chainId}?limit=100\`)
      .then(r => r.json())
      .then(d => setTokens(d.tokens ?? []))
  }, [chainId])
  return tokens
}

function App() {
  const tokens = useChainTokens(369)
  return (
    <ul>
      {tokens.map(t => (
        <li key={t.address}>
          <TokenImage chainId={t.chainId} address={t.address} alt={t.name} as="webp" />
          {t.symbol} — {t.sources?.length ?? 0} lists
        </li>
      ))}
    </ul>
  )
}`,
  },
  curl: {
    lang: 'console',
    code: `# Token image — original format
curl -o wpls.png "${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27"

# Same image converted to WebP
curl -o wpls.webp "${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.webp"

# Convert via query param
curl -o wpls.webp "${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?as=webp"

# Resize to 64x64 as WebP
curl -o wpls-64.webp "${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?w=64&h=64&as=webp"

# Only vector sources (returns 404 if no SVG exists)
curl "${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?only=vector"

# Redirect to original source URL
curl -L "${apiBase}/image/369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?mode=link"

# Ranked tokens for PulseChain
curl "${apiBase}/list/tokens/369?limit=20" | jq '.tokens[:5][] | {symbol, sources}'

# Per-chain token counts
curl "${apiBase}/stats" | jq '.[:5]'`,
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
                className="w-full rounded-lg border border-border-light dark:border-border-dark bg-surface-light-1 dark:bg-surface-1 py-2.5 pl-9 pr-4 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-accent-500/50"
              />
            </div>

            {/* Token Endpoints */}
            <section id="token-endpoints" className="scroll-mt-24 space-y-4">
              <h2 className="font-heading text-2xl font-semibold text-gray-900 dark:text-white">
                Token Information Endpoints
              </h2>
              {filteredTokenEndpoints.length > 0 ? (
                <div className="glass-card overflow-hidden">
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
                <div className="glass-card overflow-hidden">
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
                    rounded="rounded-lg"
                    prePadding="[&>pre]:px-4 [&>pre]:py-4 [&>pre]:w-fit"
                  />
                </div>
              </div>
            </section>

            {/* CTA */}
            <div className="flex justify-center pb-8">
              <Link
                to="/studio"
                className="btn-primary inline-flex items-center gap-2"
              >
                <i className="fas fa-wand-magic-sparkles" />
                Open Studio
              </Link>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
