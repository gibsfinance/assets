import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import CodeBlock from '../components/CodeBlock'
import DocsSidebar, { type DocsSidebarSection } from '../components/DocsSidebar'
import EndpointCard from '../components/EndpointCard'
import FrameworkSwitcher from '../components/FrameworkSwitcher'
import { getApiUrl } from '../utils'
import { specToSections, type OpenApiDocument, type DocsEndpointSection } from '../utils/openapi-docs'

// ---------------------------------------------------------------------------
// Static data — endpoint sections render from the served OpenAPI definition
// (/openapi.json); only non-endpoint content (features, code examples) lives
// here. Update the definition on the server to change the endpoint docs.
// ---------------------------------------------------------------------------

const apiBase = getApiUrl('')

const STATIC_SECTIONS: DocsSidebarSection[] = [
  { id: 'features', label: 'Features' },
  { id: 'code-examples', label: 'Code Examples' },
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
<img src="${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27" alt="WPLS" />

<!-- Same image converted to WebP (smaller file) -->
<img src="${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.webp" alt="WPLS" />

<!-- Resized to 64x64 as WebP -->
<img src="${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?w=64&h=64&as=webp" alt="WPLS" />

<!-- Network icon — PulseChain -->
<img src="${apiBase}/image/eip155-369" alt="PulseChain" />`,
  },
  javascript: {
    lang: 'js',
    code: `// Get all tokens for PulseChain, ranked by list priority
const res = await fetch('${apiBase}/list/tokens/eip155-369?limit=100')
const { tokens, total } = await res.json()
// tokens[0] = highest priority token (from PulseX list)
// each token has .sources[] showing which lists include it

// Get a token image as WebP
const img = await fetch('${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?as=webp')
const blob = await img.blob()
const url = URL.createObjectURL(blob)

// Filter to only vector (SVG) sources
const svg = await fetch('${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?only=vector')
// 404 if no SVG exists, 200 with SVG content if it does

// Get tokens from a specific provider list
const list = await fetch('${apiBase}/list/pulsex/extended?chainId=eip155-369')
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
  const tokens = useChainTokens('eip155-369')
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
curl -o wpls.png "${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27"

# Same image converted to WebP
curl -o wpls.webp "${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.webp"

# Convert via query param
curl -o wpls.webp "${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?as=webp"

# Resize to 64x64 as WebP
curl -o wpls-64.webp "${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?w=64&h=64&as=webp"

# Only vector sources (returns 404 if no SVG exists)
curl "${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?only=vector"

# Redirect to original source URL
curl -L "${apiBase}/image/eip155-369/0xA1077a294dDE1B09bB078844df40758a5D0f9a27?mode=link"

# Ranked tokens for PulseChain
curl "${apiBase}/list/tokens/eip155-369?limit=20" | jq '.tokens[:5][] | {symbol, sources}'

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

  // The endpoint documentation is the served OpenAPI definition — one section
  // per tag, one card per operation. Updating the definition updates the page.
  const { data: spec, isLoading: specLoading, error: specError } = useQuery({
    queryKey: ['openapi'],
    queryFn: async () => {
      const response = await fetch(getApiUrl('/openapi.json'))
      if (!response.ok) throw new Error(`${response.status}`)
      return response.json() as Promise<OpenApiDocument>
    },
    staleTime: 60 * 60 * 1000,
  })

  const endpointSections = useMemo<DocsEndpointSection[]>(
    () => (spec ? specToSections(spec, apiBase) : []),
    [spec],
  )

  const sections = useMemo<DocsSidebarSection[]>(
    () => [...endpointSections.map(({ id, label }) => ({ id, label })), ...STATIC_SECTIONS],
    [endpointSections],
  )

  // Track which section is visible via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = []

    sections.forEach(({ id }) => {
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
  }, [sections])

  const handleSectionChange = useCallback((id: string) => {
    setActiveSection(id)
  }, [])

  const filteredSections = useMemo(
    () =>
      endpointSections.map((section) => ({
        ...section,
        endpoints: filterEndpoints(section.endpoints, filterQuery),
      })),
    [endpointSections, filterQuery],
  )
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
          <a
            href={getApiUrl('/openapi.json')}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border-light dark:border-border-dark px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition-colors hover:border-accent-500/40 hover:text-accent-500"
          >
            <i className="fas fa-code text-xs" />
            OpenAPI definition
            <span className="font-mono text-xs text-gray-400 dark:text-gray-500">/openapi.json</span>
          </a>
        </div>
      </div>

      {/* Mobile tab bar — sits above the grid, hidden on desktop */}
      <DocsSidebar
        sections={sections}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        variant="mobile"
      />

      {/* Main layout */}
      <div className="container mx-auto max-w-6xl px-6 py-10">
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-12">
          {/* Desktop sticky sidebar — hidden on mobile */}
          <DocsSidebar
            sections={sections}
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

            {/* Endpoint sections — one per OpenAPI tag */}
            {specLoading && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                <i className="fas fa-spinner fa-spin mr-2" />
                Loading the API definition…
              </p>
            )}
            {specError && (
              <p className="text-sm text-red-400">
                Could not load the API definition ({(specError as Error).message}). Try the raw{' '}
                <a href={getApiUrl('/openapi.json')} className="underline">
                  /openapi.json
                </a>
                .
              </p>
            )}
            {filteredSections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-24 space-y-4">
                <h2 className="font-heading text-2xl font-semibold text-gray-900 dark:text-white">
                  {section.label}
                </h2>
                {section.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{section.description}</p>
                )}
                {section.endpoints.length > 0 ? (
                  <div className="glass-card overflow-hidden">
                    {section.endpoints.map((endpoint) => (
                      <EndpointCard key={`${endpoint.method} ${endpoint.path}`} {...endpoint} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No endpoints match &ldquo;{filterQuery}&rdquo;.
                  </p>
                )}
              </section>
            ))}

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
