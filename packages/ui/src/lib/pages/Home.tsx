import { useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMetricsContext } from '../contexts/MetricsContext'
import { useSettings } from '../contexts/SettingsContext'
import { getNetworkName } from '../utils/network-name'
import { getApiUrl } from '../utils'
import Image from '../components/Image'
import CodeBlock from '../components/CodeBlock'
import Attribution from '../components/Attribution'
import type { FloatingToken, Hex, PositionType } from '../types'

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

const tokenList = [
  { chainId: 1, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
  { chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
  { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  { chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
  { chainId: 369, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
  { chainId: 369, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
  { chainId: 369, address: '0x2b591e99afE9f32eAA6214f7B7629768c40Eeb39' },
  { chainId: 369, address: '0x2fa878Ab3F87CC1C9737Fc071108F904c0B0C95d' },
  { chainId: 369, address: '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab' },
  { chainId: 56, address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' },
]

const networkImages = [
  { chainId: 1 },
  { chainId: 10 },
  { chainId: 56 },
  { chainId: 100 },
  { chainId: 137 },
  { chainId: 324 },
  { chainId: 369 },
  { chainId: 42161 },
  { chainId: 534352 },
]

const testnetWhitelist = new Set(['ropsten', 'görli', 'rinkeby', 'kovan', 'sepolia', 'mumbai'])

function random(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function generateFloatingImages(): FloatingToken[] {
  const backgroundNetworks = networkImages.map((network) => ({
    type: 'network' as const,
    chainId: network.chainId,
    size: random(20, 30),
    speed: random(80, 110),
    delay: Math.random() < 0.5 ? random(0, 5) : random(10, 25),
    direction: Math.random() > 0.5 ? 1 : -1,
    layer: 'back' as PositionType,
    startPos: random(0, 100),
  }))

  const randomTokens = tokenList.map((token) => ({
    type: 'token' as const,
    chainId: token.chainId,
    address: token.address as Hex,
    size: random(40, 80),
    speed: random(55, 75),
    delay: Math.random() < 0.5 ? random(0, 5) : random(10, 25),
    direction: Math.random() > 0.5 ? 1 : -1,
    layer: (random(0, 1) > 0.5 ? 'middle' : 'front') as PositionType,
    startPos: random(0, 100),
  }))

  const monster: FloatingToken[] =
    Math.random() < 0.04
      ? [
          {
            size: 168,
            speed: 65,
            delay: 18,
            direction: -1,
            layer: 'front' as PositionType,
            startPos: random(0, 125),
          },
        ]
      : []

  return [...backgroundNetworks, ...randomTokens, ...monster]
}

type FloatingIconProps = {
  image: FloatingToken
  heroHeight: number
  scrollVelocity: number
}

function FloatingIcon({ image, heroHeight, scrollVelocity }: FloatingIconProps) {
  const iconRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef({
    x: image.startPos,
    y: random(0, heroHeight || 600),
  })
  const animStarted = useRef(false)
  const baseSpeed = useRef((1 / image.speed) * (image.direction === -1 ? -1 : 1))

  useEffect(() => {
    const el = iconRef.current
    if (!el) return

    let frameId: number
    let lastTime = 0

    const animate = (time: number) => {
      if (!lastTime) {
        lastTime = time
        frameId = requestAnimationFrame(animate)
        return
      }

      const delta = (time - lastTime) / 1000
      lastTime = time

      const scrollBoost = scrollVelocity * 0.02
      const effectiveSpeed = baseSpeed.current * 100 + scrollBoost * image.direction

      positionRef.current.x += effectiveSpeed * delta

      if (image.direction === 1 && positionRef.current.x > 110) {
        positionRef.current.x = -10
      } else if (image.direction === -1 && positionRef.current.x < -10) {
        positionRef.current.x = 110
      }

      const x = positionRef.current.x
      let opacity = 0.1
      if (x < 5) {
        opacity = 0.1 * (x / 5)
      } else if (x > 95) {
        opacity = 0.1 * ((100 - x) / 5)
      }

      el.style.transform = `translateX(${positionRef.current.x}vw)`
      el.style.opacity = String(Math.max(0, opacity))

      if (!animStarted.current) {
        animStarted.current = true
      }

      frameId = requestAnimationFrame(animate)
    }

    const delayMs = image.delay * 1000
    const timerId = setTimeout(() => {
      frameId = requestAnimationFrame(animate)
    }, delayMs)

    return () => {
      clearTimeout(timerId)
      cancelAnimationFrame(frameId)
    }
  }, [image.delay, image.direction, image.speed, scrollVelocity])

  const topPosition = useMemo(
    () => random(0, Math.max(heroHeight - image.size, 100)),
    [heroHeight, image.size],
  )

  const src = useMemo(() => {
    if (image.type === 'network') {
      return getApiUrl(`/image/${image.chainId}`)
    }
    if (image.type === 'token') {
      return getApiUrl(`/image/${image.chainId}/${image.address}`)
    }
    return ''
  }, [image.type, image.chainId, image.address])

  return (
    <div
      ref={iconRef}
      className="absolute rounded-full"
      style={{
        width: image.size,
        height: image.size,
        top: topPosition,
        opacity: 0,
        willChange: 'transform, opacity',
      }}
    >
      <Image
        src={src}
        alt={image.type === 'network' ? 'Network icon' : 'Token icon'}
        className="h-full w-full rounded-full"
        size={image.size}
      />
    </div>
  )
}

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
          <i className="fas fa-arrow-right hidden md:visible text-secondary-600"></i>
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
          <i className="fas fa-arrow-right hidden md:visible text-secondary-600"></i>
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
              className="h-12 w-12 rounded-full border-2 border-surface-700"
            />
            <img
              src={getApiUrl('/image/1/0x6B175474E89094C44Da98b954EedeAC495271d0F')}
              alt="Token 2"
              className="h-12 w-12 rounded-full border-2 border-surface-700"
            />
            <img
              src={getApiUrl('/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')}
              alt="Token 3"
              className="h-12 w-12 rounded-full border-2 border-surface-700"
            />
          </div>
          <i className="fas fa-arrow-right hidden md:visible text-secondary-600"></i>
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

  const heroRef = useRef<HTMLDivElement>(null)
  const scrollVelocityRef = useRef(0)
  const lastScrollTopRef = useRef(0)
  const lastScrollTimeRef = useRef(0)
  const floatingImagesRef = useRef<FloatingToken[]>(generateFloatingImages())
  const heroHeightRef = useRef(600)

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  useEffect(() => {
    const updateHeroHeight = () => {
      if (heroRef.current) {
        heroHeightRef.current = heroRef.current.offsetHeight
      }
    }

    updateHeroHeight()

    const handleScroll = () => {
      const now = performance.now()
      const scrollTop = document.scrollingElement?.scrollTop ?? 0
      const timeDelta = now - lastScrollTimeRef.current

      if (timeDelta > 0) {
        const velocity = (scrollTop - lastScrollTopRef.current) / timeDelta
        scrollVelocityRef.current = velocity * 1000
      }

      lastScrollTopRef.current = scrollTop
      lastScrollTimeRef.current = now
    }

    const decayVelocity = () => {
      scrollVelocityRef.current *= 0.95
      if (Math.abs(scrollVelocityRef.current) < 0.1) {
        scrollVelocityRef.current = 0
      }
      decayFrameId = requestAnimationFrame(decayVelocity)
    }

    let decayFrameId = requestAnimationFrame(decayVelocity)

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', updateHeroHeight)

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', updateHeroHeight)
      cancelAnimationFrame(decayFrameId)
    }
  }, [])

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

  const mainnetNetworkCount = useMemo(() => {
    if (!metricsData) return 0
    return metricsData.networks.supported.filter(
      (n) => !getNetworkName(n.chainId).toLowerCase().includes('testnet'),
    ).length
  }, [metricsData])

  const handleNetworkClick = useCallback(
    (chainId: number) => {
      localStorage.setItem('selectedChainId', chainId.toString())
      navigate('/wizard')
    },
    [navigate],
  )

  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero Section with floating icons */}
      <div ref={heroRef} className="relative overflow-hidden">
        {/* Floating background icons — contained within hero */}
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
          {floatingImagesRef.current.map((image, index) => (
            <FloatingIcon
              key={index}
              image={image}
              heroHeight={heroHeightRef.current}
              scrollVelocity={scrollVelocityRef.current}
            />
          ))}
        </div>

        <div className="relative z-20">
          <div className="mx-auto space-y-8">
            {/* Hero Section */}
            <section className="relative space-y-6 overflow-hidden rounded-lg py-8">
              <div className="absolute inset-0 -z-10 overflow-hidden blur-3xl">
                <div className="absolute -right-4 -top-4 h-72 w-96 rounded-full bg-secondary-600/10 blur-3xl"></div>
                <div className="absolute -bottom-4 -left-4 h-72 w-96 rounded-full bg-secondary-600/10 blur-3xl"></div>
              </div>

              <div className="space-y-2">
                <p className="font-space-grotesk w-full text-center text-lg font-medium tracking-wide dark:text-gray-200">
                  Welcome to
                </p>
                <h1 className="font-space-grotesk w-full bg-gradient-to-r text-gray-900 dark:text-white bg-clip-text text-center text-6xl font-bold tracking-tight">
                  Gib<span className="text-secondary-600">.Show</span>
                </h1>
              </div>

              <div className="mx-auto max-w-3xl text-xl font-light text-gray-500 dark:text-gray-400 text-center flex flex-col gap-2">
                <p>A decentralized solution for token metadata and assets across multiple blockchains.</p>
                <p>Stop struggling with missing logos, broken images, and inconsistent token data.</p>
                <p>One API to handle all your token asset needs that you can run yourself.</p>
                <p>
                  Quit relying on middlemen. <span className="font-bold">Be your own.</span>
                </p>
              </div>
            </section>

            <Attribution />
          </div>
        </div>
      </div>

      {/* Main content below hero */}
      <div className="relative z-20 flex-1">
        <div className="container mx-auto md:px-4">
          {/* Features Grid */}
          <section className="space-y-8 py-8">
            <h2 className="h2 text-center text-3xl font-bold">Why Use Your Own Asset Server?</h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="feature-card group md:rounded-lg border border-gray-200 bg-white p-6 transition-all hover:scale-[1.02] hover:shadow-lg dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="relative">
                    <div className="flex items-center gap-4">
                      <i
                        className={`fas ${feature.icon} mb-4 text-4xl text-secondary-600 transition-transform group-hover:scale-110`}
                      ></i>
                      <h3 className="h3 mb-2 font-bold">{feature.title}</h3>
                    </div>
                    <p className="text-gray-600 dark:text-gray-300">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Integration Examples */}
          <section className="space-y-8 py-8">
            <h2 className="h2 text-center text-3xl font-bold">Simple Integration</h2>
            <div className="grid gap-6">
              {examples.map((example) => (
                <div
                  key={example.type}
                  className="card p-6 rounded-none md:rounded-lg transition-all bg-white dark:bg-gray-900 hover:shadow hover:shadow-secondary-600/5 border border-gray-200 dark:border-gray-700"
                >
                  <div className="grid gap-6 lg:grid-cols-2">
                    {/* Visual Preview */}
                    <div className="flex items-center justify-center rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
                      <ExamplePreview type={example.type} displayUrl={example.displayUrl} />
                    </div>

                    {/* Description */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-secondary-600/10 p-3">
                          <i className={`fas ${example.icon} text-2xl text-secondary-600`}></i>
                        </div>
                        <h3 className="h3 font-bold">{example.title}</h3>
                      </div>
                      <p className="text-gray-600 dark:text-gray-300">{example.description}</p>
                      <a
                        href={example.code}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
                      >
                        <i className="fas fa-link text-secondary-600"></i>
                        <code className="break-all font-mono">{example.code}</code>
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Metrics */}
          <section className="space-y-8 py-8">
            <h2 className="h2 text-center text-3xl font-bold">Platform Metrics</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="metric-card group md:rounded-lg border border-gray-200 bg-white p-6 transition-all hover:shadow-lg hover:shadow-secondary-600/5 dark:border-gray-700 dark:bg-gray-900">
                {metricsData ? (
                  <span className="mb-2 block bg-gradient-to-r from-secondary-600 to-[#00b368] bg-clip-text text-center text-5xl font-bold text-transparent">
                    {metricsData.tokenList.total.toLocaleString()}+
                  </span>
                ) : (
                  <span className="mb-2 block animate-pulse text-center text-5xl font-bold">---</span>
                )}
                <p className="text-center text-lg text-gray-600 dark:text-gray-300">Total Tokens</p>
              </div>
              <div className="metric-card group md:rounded-lg border border-gray-200 dark:border-gray-700 bg-white p-6 transition-all hover:shadow-lg hover:shadow-secondary-600/5 dark:bg-gray-900">
                {metricsData ? (
                  <span className="mb-2 block bg-gradient-to-r from-secondary-600 to-[#00b368] bg-clip-text text-center text-5xl font-bold text-transparent">
                    {mainnetNetworkCount}
                  </span>
                ) : (
                  <span className="mb-2 block animate-pulse text-center text-5xl font-bold">---</span>
                )}
                <p className="text-center text-lg text-gray-600 dark:text-gray-300">Supported Networks</p>
              </div>
            </div>

            {/* Token Distribution Visualization */}
            {metricsData ? (
              <div className="card p-4">
                <h3 className="h3 mb-4 text-center">Tokens by Chain</h3>

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
                      <div className="h-6 w-11 rounded-full bg-gray-300 dark:bg-gray-700 transition-colors peer-checked:bg-secondary-600/20"></div>
                      <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white dark:bg-gray-200 transition-all peer-checked:translate-x-5 peer-checked:bg-secondary-600"></div>
                    </div>
                    <span className="text-sm font-medium text-gray-600 transition-colors dark:text-gray-300">
                      Show Testnets
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {filteredNetworks.map((network) => (
                    <button
                      key={network.chainId}
                      type="button"
                      onClick={() => handleNetworkClick(network.chainId)}
                      className="group relative cursor-pointer transition-all duration-200 hover:scale-105"
                    >
                      <div className="absolute inset-0 rounded-lg bg-secondary-600 opacity-10 group-hover:opacity-15"></div>
                      <div className="card variant-ghost relative flex h-[160px] flex-col items-center justify-between rounded-lg border border-secondary-600/20 p-3 hover:border-secondary-600/40">
                        <div className="flex flex-1 flex-col items-center">
                          <Image
                            src={getApiUrl(`/image/${network.chainId}`)}
                            alt={network.name}
                            className="h-10 w-10 flex-shrink-0 rounded-full"
                            size={40}
                          />
                          <div className="mt-2 flex w-full flex-1 flex-col justify-center text-center">
                            <div
                              className="line-clamp-2 px-1 text-sm font-medium leading-tight"
                              title={network.name}
                            >
                              {network.name}
                            </div>
                            <div className="mt-1 font-mono text-xs text-surface-300">
                              ID: {network.chainId}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex-shrink-0 text-base font-bold text-secondary-600">
                          {network.tokenCount.toLocaleString()}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card p-4">
                <div className="h-[400px] animate-pulse bg-gray-200 dark:bg-gray-600/20"></div>
              </div>
            )}
          </section>

          {/* CTA */}
          <section className="card mb-8 space-y-4 p-8 text-center">
            <h2 className="h2">Ready to Get Started?</h2>
            <p className="text-lg">Try our URL wizard to generate the perfect integration for your needs.</p>
            <a href="#/wizard" className="btn bg-secondary-600 text-black">
              <i className="fas fa-hat-wizard mr-2"></i>
              Wizard
            </a>
          </section>
        </div>
      </div>
    </div>
  )
}
