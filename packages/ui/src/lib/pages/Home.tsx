import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMetricsContext } from '../contexts/MetricsContext'
import { useSettings } from '../contexts/SettingsContext'
import { getNetworkName } from '../utils/network-name'
import { getApiUrl } from '../utils'
import CodeBlock from '../components/CodeBlock'
import Attribution from '../components/Attribution'
import FloatingIcons from '../components/FloatingIcons'
import CountUpNumber from '../components/CountUpNumber'

const features = [
  {
    icon: 'fa-cloud',
    title: 'Always Available',
    description:
      'Decentralized storage ensures your token assets are always accessible. No more missing images or failed requests.',
  },
  {
    icon: 'fa-bolt',
    title: 'Lightning Fast',
    description: 'Optimized delivery with global CDN and efficient caching. Get token data in milliseconds.',
  },
  {
    icon: 'fa-shield',
    title: 'Reliable & Secure',
    description: 'Verified token data from trusted sources. No more scam tokens or incorrect metadata.',
  },
]

const examples = [
  {
    type: 'token-image',
    icon: 'fa-image',
    title: 'Token Images',
    description: 'Fetch token logo for any token on any supported chain. Automatically handles fallback assets.',
    code: getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    displayUrl: `/image/1/0x2260...`,
  },
  {
    type: 'network-image',
    icon: 'fa-network-wired',
    title: 'Network Logos',
    description: 'Get chain/network logos and metadata. Perfect for network selectors.',
    code: getApiUrl('/image/1'),
    displayUrl: `/image/1`,
  },
  {
    type: 'token-list',
    icon: 'fa-list',
    title: 'Token Lists',
    description: 'Get curated token lists with optional network filtering.',
    code: getApiUrl('/list/coingecko'),
    displayUrl: `/list/coingecko`,
  },
]

const testnetWhitelist = new Set(['ropsten', 'görli', 'rinkeby', 'kovan', 'sepolia', 'mumbai'])

type ExamplePreviewProps = {
  type: string
  displayUrl: string
}

function ExamplePreview({ type, displayUrl }: ExamplePreviewProps) {
  if (type === 'token-image') {
    return (
      <div className="flex flex-col md:flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-3">
          <img
            src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
            alt="WBTC Token"
            className="h-12 w-12 rounded-full"
          />
          <i className="fas fa-arrow-right hidden md:visible text-accent-500"></i>
        </div>
        <CodeBlock code={displayUrl} />
      </div>
    )
  }

  if (type === 'network-image') {
    return (
      <div className="flex flex-col md:flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-3">
          <img src={getApiUrl('/image/1')} alt="Ethereum" className="h-12 w-12 rounded-full" />
          <i className="fas fa-arrow-right hidden md:visible text-accent-500"></i>
        </div>
        <CodeBlock code={displayUrl} />
      </div>
    )
  }

  if (type === 'token-list') {
    return (
      <div className="flex flex-col md:flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-3">
          <div className="flex -space-x-4">
            <img
              src={getApiUrl('/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
              alt="Token 1"
              className="h-12 w-12 rounded-full border-2 border-surface-2"
            />
            <img
              src={getApiUrl('/image/1/0x6B175474E89094C44Da98b954EedeAC495271d0F')}
              alt="Token 2"
              className="h-12 w-12 rounded-full border-2 border-surface-2"
            />
            <img
              src={getApiUrl('/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')}
              alt="Token 3"
              className="h-12 w-12 rounded-full border-2 border-surface-2"
            />
          </div>
          <i className="fas fa-arrow-right hidden md:visible text-accent-500"></i>
        </div>
        <CodeBlock code={displayUrl} />
      </div>
    )
  }

  return null
}

export default function Home() {
  const navigate = useNavigate()
  const { metrics: metricsData, fetchMetrics } = useMetricsContext()
  const { showTestnets, setShowTestnets } = useSettings()

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  const filteredNetworks = useMemo(() => {
    if (!metricsData) return []

    return metricsData.networks.supported
      .map((n) => {
        const nameKey = getNetworkName(n.chainId).toLowerCase()
        const isTestnet = nameKey.includes('testnet') || testnetWhitelist.has(nameKey)
        return {
          chainId: n.chainId,
          name: getNetworkName(n.chainId),
          tokenCount: metricsData.tokenList.byChain[n.chainId] || 0,
          isTestnet,
        }
      })
      .filter((n) => n.tokenCount > 0)
      .filter((n) => showTestnets || !n.isTestnet)
      .sort((a, b) => {
        if (!a.isTestnet && b.isTestnet) return -1
        if (a.isTestnet && !b.isTestnet) return 1
        return b.tokenCount - a.tokenCount
      })
  }, [metricsData, showTestnets])

  const gridRef = useRef<HTMLDivElement>(null)
  const [gridCols, setGridCols] = useState(6)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const detect = () => {
      const style = getComputedStyle(el)
      const cols = style.gridTemplateColumns.split(' ').length
      if (cols > 0) setGridCols(cols)
    }
    detect()
    const observer = new ResizeObserver(detect)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const MAX_ROWS = 3
  const maxVisible = gridCols * MAX_ROWS
  const evenCount = Math.floor(Math.min(filteredNetworks.length, maxVisible) / gridCols) * gridCols
  const visibleNetworks = filteredNetworks.slice(0, evenCount)
  const hiddenCount = filteredNetworks.length - evenCount

  const mainnetNetworkCount = useMemo(() => {
    if (!metricsData) return 0
    return metricsData.networks.supported.filter(
      (n) => !getNetworkName(n.chainId).toLowerCase().includes('testnet'),
    ).length
  }, [metricsData])

  const handleNetworkClick = useCallback(
    (chainId: number) => {
      localStorage.setItem('selectedChainId', chainId.toString())
      navigate('/studio')
    },
    [navigate],
  )

  return (
    <div className="flex min-h-screen flex-col bg-surface-light-base dark:bg-surface-base">
      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <p className="mb-4 font-heading text-lg font-medium tracking-wide text-gray-600 dark:text-gray-300">
            Welcome to
          </p>
          <h1 className="font-heading text-6xl font-bold tracking-tight md:text-7xl">
            Gib<span className="text-gradient-brand">.Show</span>
          </h1>

          <div className="mx-auto mt-8 max-w-3xl space-y-2 text-xl font-light text-gray-500 dark:text-gray-400">
            <p>A decentralized solution for token metadata and assets across multiple blockchains.</p>
            <p>Stop struggling with missing logos, broken images, and inconsistent token data.</p>
            <p>One API to handle all your token asset needs that you can run yourself.</p>
            <p>
              Quit relying on middlemen. <span className="font-bold">Be your own.</span>
            </p>
          </div>
        </div>

        <div className="mt-12">
          <Attribution />
        </div>

        {/* Streaming icon band — dense horizontal flow of network icons */}
        <div className="mt-8">
          <FloatingIcons className="opacity-80" />
        </div>
      </section>

      {/* Main content */}
      <div className="relative z-10 flex-1">
        <div className="container mx-auto px-4">
          {/* Value Proposition — Feature Cards */}
          <section className="space-y-8 py-12">
            <h2 className="font-heading text-center text-3xl font-bold text-gray-900 dark:text-white">
              Why Use Your Own Asset Server?
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="glass-card group p-6 transition-all duration-200 hover:scale-[1.02] hover:shadow-glow-green-subtle"
                >
                  <div className="flex items-center gap-4">
                    <i
                      className={`fas ${feature.icon} mb-4 text-4xl text-accent-500 transition-transform group-hover:scale-110`}
                    ></i>
                    <h3 className="mb-2 font-heading text-lg font-bold text-gray-900 dark:text-white">
                      {feature.title}
                    </h3>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300">{feature.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Integration Examples */}
          <section className="space-y-8 py-12">
            <h2 className="font-heading text-center text-3xl font-bold text-gray-900 dark:text-white">
              Simple Integration
            </h2>
            <div className="grid gap-6">
              {examples.map((example) => (
                <div
                  key={example.type}
                  className="glass-card p-6 transition-all duration-200 hover:shadow-glow-green-subtle"
                >
                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* Visual Preview */}
                    <div className="flex items-center justify-center rounded-xl bg-surface-light-2 p-4 dark:bg-surface-2">
                      <ExamplePreview type={example.type} displayUrl={example.displayUrl} />
                    </div>

                    {/* Description */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="rounded-xl bg-accent-500/10 p-3">
                          <i className={`fas ${example.icon} text-2xl text-accent-500`}></i>
                        </div>
                        <h3 className="font-heading text-lg font-bold text-gray-900 dark:text-white">
                          {example.title}
                        </h3>
                      </div>
                      <p className="text-gray-600 dark:text-gray-300">{example.description}</p>
                      <a
                        href={example.code}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
                      >
                        <i className="fas fa-link text-accent-500"></i>
                        <code className="break-all font-mono">{example.code}</code>
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Platform Metrics */}
          <section className="space-y-8 py-12">
            <h2 className="font-heading text-center text-3xl font-bold text-gray-900 dark:text-white">
              Platform Metrics
            </h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="glass-card group p-6 text-center transition-all duration-200 hover:shadow-glow-green-subtle">
                {metricsData ? (
                  <span className="mb-2 block text-5xl font-bold">
                    <CountUpNumber end={metricsData.tokenList.total} className="text-gradient-green" />
                    <span className="text-gradient-green">+</span>
                  </span>
                ) : (
                  <span className="mb-2 block animate-pulse text-5xl font-bold text-gray-400">---</span>
                )}
                <p className="text-lg text-gray-600 dark:text-gray-300">Total Tokens</p>
              </div>
              <div className="glass-card group p-6 text-center transition-all duration-200 hover:shadow-glow-green-subtle">
                {metricsData ? (
                  <span className="mb-2 block text-5xl font-bold">
                    <CountUpNumber end={mainnetNetworkCount} className="text-gradient-green" />
                  </span>
                ) : (
                  <span className="mb-2 block animate-pulse text-5xl font-bold text-gray-400">---</span>
                )}
                <p className="text-lg text-gray-600 dark:text-gray-300">Supported Networks</p>
              </div>
            </div>

            {/* Network Distribution */}
            {metricsData ? (
              <div className="glass-card p-6">
                <h3 className="mb-4 text-center font-heading text-xl font-bold text-gray-900 dark:text-white">
                  Tokens by Chain
                </h3>

                {/* Testnet toggle */}
                <div className="mb-4 flex justify-end">
                  <label className="group flex cursor-pointer items-center gap-3">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={showTestnets}
                        onChange={(e) => setShowTestnets(e.target.checked)}
                      />
                      <div className="h-6 w-11 rounded-full bg-surface-light-3 transition-colors peer-checked:bg-accent-500/20 dark:bg-surface-3"></div>
                      <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-all peer-checked:translate-x-5 peer-checked:bg-accent-500 dark:bg-gray-200"></div>
                    </div>
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Show Testnets</span>
                  </label>
                </div>

                <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {visibleNetworks.map((network) => (
                    <button
                      key={network.chainId}
                      type="button"
                      onClick={() => handleNetworkClick(network.chainId)}
                      className="group relative cursor-pointer transition-all duration-200 hover:scale-105"
                    >
                      <div className="glass-card relative flex h-[160px] flex-col items-center justify-between p-3 transition-all duration-200 hover:border-accent-500/40 hover:shadow-glow-green-subtle">
                        <div className="flex flex-1 flex-col items-center">
                          <img
                            src={getApiUrl(`/image/${network.chainId}`)}
                            alt={network.name}
                            className="h-10 w-10 flex-shrink-0 rounded-full"
                            width={40}
                            height={40}
                            onError={(e) => {
                              const card = (e.target as HTMLElement).closest('button')
                              if (card) card.style.display = 'none'
                            }}
                          />
                          <div className="mt-2 flex w-full flex-1 flex-col justify-center text-center">
                            <div
                              className="line-clamp-2 px-1 text-sm font-medium leading-tight text-gray-900 dark:text-white"
                              title={network.name}
                            >
                              {network.name}
                            </div>
                            <div className="mt-1 font-mono text-xs text-gray-400 dark:text-gray-500">
                              ID: {network.chainId}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex-shrink-0 text-base font-bold text-accent-500">
                          {network.tokenCount.toLocaleString()}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {hiddenCount > 0 && (
                  <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    and {hiddenCount} more network{hiddenCount === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            ) : (
              <div className="glass-card p-6">
                <div className="h-[400px] animate-pulse rounded-xl bg-surface-light-2 dark:bg-surface-2"></div>
              </div>
            )}
          </section>

          {/* CTA */}
          <section className="mb-8 glass-card space-y-4 p-8 text-center">
            <h2 className="font-heading text-2xl font-bold text-gray-900 dark:text-white">Ready to Get Started?</h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Open the Studio to browse tokens, configure URLs, and explore the API.
            </p>
            <button type="button" onClick={() => navigate('/studio')} className="btn-primary inline-flex items-center gap-2">
              <i className="fas fa-flask"></i>
              Open Studio
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
