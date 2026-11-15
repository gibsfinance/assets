import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useMetrics } from '../hooks/useMetrics'
import { useSettings } from '../contexts/SettingsContext'
import { countSupportedNetworks } from '../utils/network-metrics'
import { getApiUrl } from '../utils'
import { getDocsUrl, type DocsPageName } from '../utils/docs-links'
import {
  IMAGE_OPTION_SUBJECT_PATH,
  IMAGE_OPTION_TILES,
  SPRITE_MANIFEST_PATH,
  SPRITE_SHEET_PATH,
  SPRITE_STYLESHEET_PATH,
  spriteSnippet,
  type ImageOptionSurface,
  type ImageOptionTile as ImageOptionTileData,
} from '../utils/integration-examples'
import { prefetchStudioWhenIdle } from './load-studio'
import CodeBlock from '../components/CodeBlock'
import Attribution from '../components/Attribution'
import FloatingIcons from '../components/FloatingIcons'
import CountUpNumber from '../components/CountUpNumber'
import Image from '../components/Image'
import IntegrationCard, { IntegrationAddress } from '../components/IntegrationCard'
import {
  faArrowRight,
  faBolt,
  faCloud,
  faFlask,
  faImage,
  faLayerGroup,
  faList,
  faListUl,
  faNetworkWired,
  faShield,
  faSliders,
} from '@fortawesome/free-solid-svg-icons'
import { Icon } from '../components/Icon'

const features = [
  {
    icon: faCloud,
    title: 'Always Available',
    description:
      'Decentralized storage ensures your token assets are always accessible. No more missing images or failed requests.',
  },
  {
    icon: faBolt,
    title: 'Lightning Fast',
    description: 'Optimized delivery with global CDN and efficient caching. Get token data in milliseconds.',
  },
  {
    icon: faShield,
    title: 'Reliable & Secure',
    description: 'Verified token data from trusted sources. No more scam tokens or incorrect metadata.',
  },
]

/** Each card's documentation page, by the name `DOCS_PAGES` gives it. */
const examples: {
  type: string
  icon: typeof faImage
  title: string
  description: string
  code: string
  displayUrl: string
  docsPage: DocsPageName
}[] = [
  {
    type: 'token-image',
    icon: faImage,
    title: 'Token Images',
    description: 'Fetch token logo for any token on any supported chain. Automatically handles fallback assets.',
    code: getApiUrl('/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    displayUrl: `/image/eip155-1/0x2260...`,
    docsPage: 'images',
  },
  {
    type: 'network-image',
    icon: faNetworkWired,
    title: 'Network Logos',
    description: 'Get chain/network logos and metadata. Perfect for network selectors.',
    code: getApiUrl('/image/eip155-1'),
    displayUrl: `/image/eip155-1`,
    docsPage: 'networks',
  },
  {
    type: 'token-list',
    icon: faList,
    title: 'Token Lists',
    description: 'Get curated token lists with optional network filtering.',
    code: getApiUrl('/list/coingecko'),
    displayUrl: `/list/coingecko`,
    docsPage: 'tokenLists',
  },
]

/** The logo well's background, by the surface a tile names. A dark logo needs the dark well. */
const WELL_SURFACE_CLASS: Record<ImageOptionSurface, string> = {
  inset: 'bg-surface-inset',
  backdrop: 'bg-surface-backdrop',
}

type ImageOptionTileProps = {
  tile: ImageOptionTileData
}

/**
 * One option in the image options card: its title and sentences, then each of its logos with
 * the address that drew it.
 *
 * The logos are drawn at the exact address shown, through `fullResolution`. Without it the
 * shared image component would add its own size and format to the request, and the reader
 * would see one address on the page and be served another.
 */
function ImageOptionTile({ tile }: ImageOptionTileProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <div>
        <h4 className="font-heading text-sm font-bold text-content-strong">{tile.title}</h4>
        <p className="mt-1 text-sm text-content-secondary">{tile.description}</p>
      </div>
      {tile.samples.map((sample) => (
        <div key={sample.path} className="flex flex-col items-start gap-2">
          <div className={`flex rounded-md p-2 ${WELL_SURFACE_CLASS[tile.surface]}`}>
            <Image src={getApiUrl(sample.path)} alt={sample.alt} size={64} fullResolution shape="rect" />
          </div>
          {sample.caption && <p className="text-xs text-content-subtle">{sample.caption}</p>}
          <IntegrationAddress href={getApiUrl(sample.path)} />
        </div>
      ))}
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
          <Image
            src={getApiUrl('/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
            alt="WBTC Token"
            skeleton
            shape="circle"
            size={48}
            className="rounded-full"
          />
          <Icon icon={faArrowRight} className="hidden md:visible text-accent-content" />
        </div>
        <CodeBlock code={displayUrl} />
      </div>
    )
  }

  if (type === 'network-image') {
    return (
      <div className="flex flex-col md:flex-row items-center gap-4">
        <div className="flex flex-row items-center gap-3">
          <Image
            src={getApiUrl('/image/eip155-1')}
            alt="Ethereum"
            size={48}
            skeleton
            shape="circle"
            className="rounded-full"
          />
          <Icon icon={faArrowRight} className="hidden md:visible text-accent-content" />
        </div>
        <CodeBlock code={displayUrl} />
      </div>
    )
  }

  // The only caller is the map below over the module-level `examples` list, which
  // declares exactly three entries: 'token-image', 'network-image', 'token-list'. The
  // first two are handled above, so reaching this point means the type is 'token-list'.
  // There is no fourth type to fall through to, so this closing branch needs no guard
  // and no dead default beneath it.
  return (
    <div className="flex flex-col md:flex-row items-center gap-4">
      <div className="flex flex-row items-center gap-3">
        <div className="flex -space-x-4">
          <Image
            src={getApiUrl('/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')}
            alt="Token 1"
            skeleton
            shape="circle"
            size={48}
            className="rounded-full border-2 border-border-overlap"
          />
          <Image
            src={getApiUrl('/image/eip155-1/0x6B175474E89094C44Da98b954EedeAC495271d0F')}
            alt="Token 2"
            skeleton
            shape="circle"
            size={48}
            className="rounded-full border-2 border-border-overlap"
          />
          <Image
            src={getApiUrl('/image/eip155-1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')}
            alt="Token 3"
            skeleton
            shape="circle"
            size={48}
            className="rounded-full border-2 border-border-overlap"
          />
        </div>
        <Icon icon={faArrowRight} className="hidden md:visible text-accent-content" />
      </div>
      <CodeBlock code={displayUrl} />
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { metrics: metricsData, isError: metricsFailed } = useMetrics()
  const { showTestnets, setShowTestnets } = useSettings()

  // Most visitors who stay on this page go to the Studio next. Fetch its code while
  // the browser has nothing better to do, so the click does not wait on it.
  useEffect(() => prefetchStudioWhenIdle(), [])

  const filteredNetworks = useMemo(() => {
    if (!metricsData) return []

    // Reads the name and isTestnet useMetrics resolved. This used to re-derive both
    // from the identifier with a substring match and a hand-kept whitelist — a third
    // testnet rule alongside isTestnet and the drawer's, and one that missed anything
    // named "Test Network" rather than "Testnet".
    return metricsData.networks.supported
      .filter((n) => n.tokenCount > 0)
      .filter((n) => showTestnets || !n.isTestnet)
      .sort((a, b) => {
        if (!a.isTestnet && b.isTestnet) return -1
        if (a.isTestnet && !b.isTestnet) return 1
        return b.tokenCount - a.tokenCount
      })
  }, [metricsData, showTestnets])

  const [gridCols, setGridCols] = useState(6)
  const gridObserver = useRef<ResizeObserver | null>(null)

  /**
   * Measures how many columns the grid actually laid out, and keeps measuring as it
   * resizes.
   *
   * This has to attach through a callback ref rather than an effect reading a ref object.
   * The grid is only rendered once the metrics arrive, so an effect running on mount found
   * nothing to observe, and with an empty dependency list it never ran again — the column
   * count stayed on its initial 6 for the life of the page. Six is not a multiple of the
   * four-column layout, so the row-filling below drew exactly the partial trailing row it
   * exists to avoid, and on a two-column viewport it capped the grid at eighteen tiles
   * instead of the three rows MAX_ROWS asks for.
   */
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridObserver.current?.disconnect()
    gridObserver.current = null
    if (!el) return
    const detect = () => {
      // String.prototype.split never returns an array shorter than one entry, even for
      // an empty string, so this count can never be zero. There is no low count to guard
      // against.
      const cols = getComputedStyle(el).gridTemplateColumns.split(' ').length
      setGridCols(cols)
    }
    detect()
    const observer = new ResizeObserver(detect)
    observer.observe(el)
    gridObserver.current = observer
  }, [])

  const [failedChains, setFailedChains] = useState<Set<number>>(() => new Set())
  const handleImageError = useCallback((chainId: number) => {
    setFailedChains((prev) => {
      if (prev.has(chainId)) return prev
      const next = new Set(prev)
      next.add(chainId)
      return next
    })
  }, [])

  const mainnetNetworkCount = useMemo(() => {
    if (!metricsData) return 0
    return countSupportedNetworks(metricsData.networks.supported)
  }, [metricsData])

  const MAX_ROWS = 3
  const loadableNetworks = filteredNetworks.filter((n) => !failedChains.has(n.chainId))
  const maxVisible = gridCols * MAX_ROWS
  const evenCount = Math.floor(Math.min(loadableNetworks.length, maxVisible) / gridCols) * gridCols
  const visibleNetworks = loadableNetworks.slice(0, evenCount)
  // Count the hidden remainder against the same "Supported Networks" universe the
  // headline advertises (has tokens or a logo, excluding testnets) rather than the
  // token-bearing subset the grid renders. Otherwise "and N more networks" (e.g.
  // 211) silently contradicts the "Supported Networks" total (e.g. 282) shown just
  // above it. Logo-only chains have zero tokens, sort to the bottom, and never fill
  // the visible rows, so they only ever land in the "more" remainder.
  const hiddenCount = Math.max(0, mainnetNetworkCount - visibleNetworks.length)

  const handleNetworkClick = useCallback(
    (chainIdentifier: string) => {
      localStorage.setItem('selectedChainId', chainIdentifier)
      navigate('/studio')
    },
    [navigate],
  )

  // A pulsing placeholder is a promise that the number is on its way. Once the
  // request has failed it is not coming, and animating forever says otherwise.
  // Both states show dashes rather than a figure, because the honest answer to
  // "how many networks" here is that we do not know — which is the whole reason
  // the fetchers throw instead of resolving to an empty list.
  const metricPlaceholder = (
    <span className={`mb-2 block text-5xl font-bold text-content-faint ${metricsFailed ? '' : 'animate-pulse'}`}>
      ---
    </span>
  )

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <p className="mb-4 font-heading text-lg font-medium tracking-wide text-content-secondary">Welcome to</p>
          <h1 className="font-heading text-6xl font-bold tracking-tight md:text-7xl">
            Gib<span className="text-gradient-brand">.Show</span>
          </h1>

          <div className="mx-auto mt-8 max-w-3xl space-y-2 text-xl font-light text-content-subtle">
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
            <h2 className="font-heading text-center text-3xl font-bold text-content-strong">
              Why Use Your Own Asset Server?
            </h2>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="glass-card group p-6 transition-all duration-200 hover:scale-[1.02] motion-reduce:hover:scale-100 hover:shadow-glow-accent-subtle">
                  <div className="flex items-center gap-4">
                    <Icon
                      icon={feature.icon}
                      className="mb-4 text-4xl text-accent-content transition-transform group-hover:scale-110 motion-reduce:group-hover:scale-100"
                    />
                    <h3 className="mb-2 font-heading text-lg font-bold text-content-strong">{feature.title}</h3>
                  </div>
                  <p className="text-content-secondary">{feature.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Integration Examples */}
          <section className="space-y-8 py-12">
            <h2 className="font-heading text-center text-3xl font-bold text-content-strong">Simple Integration</h2>
            <div className="grid gap-6">
              {examples.map((example) => (
                <IntegrationCard
                  key={example.type}
                  icon={example.icon}
                  title={example.title}
                  description={example.description}
                  docsHref={getDocsUrl(example.docsPage)}
                  preview={<ExamplePreview type={example.type} displayUrl={example.displayUrl} />}>
                  <IntegrationAddress href={example.code} />
                </IntegrationCard>
              ))}

              <IntegrationCard
                icon={faSliders}
                title="Image Options"
                description="Add options to a token or network image address to resize it, change its format, or put a plate behind a logo. The examples use Wrapped Bitcoin, and the dark-page example uses Cronos, a dark logo."
                docsHref={getDocsUrl('imageOptions')}
                preview={
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Image
                      src={getApiUrl(IMAGE_OPTION_SUBJECT_PATH)}
                      alt="Wrapped Bitcoin logo"
                      size={128}
                      fullResolution
                      shape="rect"
                    />
                    <p className="text-sm text-content-subtle">Wrapped Bitcoin, drawn by three of the options below</p>
                  </div>
                }>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  {IMAGE_OPTION_TILES.map((tile) => (
                    <ImageOptionTile key={tile.key} tile={tile} />
                  ))}
                </div>
              </IntegrationCard>

              <IntegrationCard
                icon={faLayerGroup}
                title="Sprite Sheets"
                description="One request draws a whole list. The sheet is one picture of every logo in the list, and the manifest says where each token sits in it."
                docsHref={getDocsUrl('spriteSheets')}
                preview={
                  <div className="flex max-w-full flex-col items-center gap-3 overflow-x-auto">
                    <Image
                      src={getApiUrl(SPRITE_SHEET_PATH)}
                      alt="Logos of the PulseX token list, drawn as one sheet"
                      width={320}
                      height={64}
                      fullResolution
                      skeleton
                      shape="rect"
                    />
                    <IntegrationAddress href={getApiUrl(SPRITE_SHEET_PATH)} />
                  </div>
                }>
                <IntegrationAddress href={getApiUrl(SPRITE_MANIFEST_PATH)} />
                <CodeBlock
                  code={spriteSnippet({ stylesheetUrl: getApiUrl(SPRITE_STYLESHEET_PATH) })}
                  lang="html"
                  preClasses="[&>pre]:whitespace-pre-wrap [&>pre]:break-all"
                />
                <p className="text-sm text-content-subtle">
                  Add chainId to keep one chain, content=mixed for vector logos as data addresses, gap for space between
                  cells, bg or contrast for a plate behind each logo, and scale=2 for sharp sheets on high-density
                  screens. Sizes run from 16 to 128 pixels for size, 5 to 50 for cols, and 1 to 2000 tokens for limit.
                </p>
              </IntegrationCard>
            </div>
          </section>

          {/* Platform Metrics */}
          <section className="space-y-8 py-12">
            <h2 className="font-heading text-center text-3xl font-bold text-content-strong">Platform Metrics</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="glass-card group p-6 text-center transition-all duration-200 hover:shadow-glow-accent-subtle">
                {metricsData ? (
                  <span className="mb-2 block text-5xl font-bold">
                    <CountUpNumber end={metricsData.tokenList.total} className="text-gradient-accent" />
                    <span className="text-gradient-accent">+</span>
                  </span>
                ) : (
                  metricPlaceholder
                )}
                <p className="text-lg text-content-secondary">Total Tokens</p>
              </div>
              <div className="glass-card group p-6 text-center transition-all duration-200 hover:shadow-glow-accent-subtle">
                {metricsData ? (
                  <span className="mb-2 block text-5xl font-bold">
                    <CountUpNumber end={mainnetNetworkCount} className="text-gradient-accent" />
                  </span>
                ) : (
                  metricPlaceholder
                )}
                <p className="text-lg text-content-secondary">Supported Networks</p>
              </div>
            </div>

            {/* Network Distribution */}
            {metricsData ? (
              <div className="glass-card p-6">
                <h3 className="mb-4 text-center font-heading text-xl font-bold text-content-strong">Tokens by Chain</h3>

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
                      <div className="h-6 w-11 rounded-full bg-surface-active transition-colors peer-checked:bg-accent/20"></div>
                      <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-surface-thumb transition-all peer-checked:translate-x-5 peer-checked:bg-accent"></div>
                    </div>
                    <span className="text-sm font-medium text-content-secondary">Show Testnets</span>
                  </label>
                </div>

                <div ref={gridRef} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {visibleNetworks.map((network) => (
                    <button
                      key={network.chainId}
                      type="button"
                      onClick={() => handleNetworkClick(network.chainIdentifier)}
                      className="group relative cursor-pointer transition-all duration-200 hover:scale-105 motion-reduce:hover:scale-100">
                      <div className="glass-card relative flex h-[160px] flex-col items-center justify-between p-3 transition-all duration-200 hover:border-accent/40 hover:shadow-glow-accent-subtle">
                        <div className="flex flex-1 flex-col items-center">
                          <Image
                            src={getApiUrl(`/image/${network.chainIdentifier}`)}
                            alt={network.name}
                            size={40}
                            skeleton
                            lazy
                            shape="circle"
                            className="rounded-full"
                            onError={() => handleImageError(network.chainId)}
                          />
                          <div className="mt-2 flex w-full flex-1 flex-col justify-center text-center">
                            <div
                              className="line-clamp-2 px-1 text-sm font-medium leading-tight text-content-strong"
                              title={network.name}>
                              {network.name}
                            </div>
                            <div className="mt-1 font-mono text-xs text-content-faint">ID: {network.chainId}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex-shrink-0 text-base font-bold text-accent-content">
                          {network.tokenCount.toLocaleString()}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {hiddenCount > 0 && (
                  <p className="mt-4 text-center text-sm text-content-subtle">
                    and {hiddenCount} more network{hiddenCount === 1 ? '' : 's'}
                  </p>
                )}
              </div>
            ) : metricsFailed ? (
              <div className="glass-card p-6 text-center">
                <p className="text-lg text-content-secondary">
                  Could not load the network breakdown. Reload to try again.
                </p>
              </div>
            ) : (
              <div className="glass-card p-6">
                <div className="h-[400px] animate-pulse rounded-lg bg-surface-inset"></div>
              </div>
            )}
          </section>

          {/* CTA */}
          <section className="mb-8 glass-card space-y-4 p-8 text-center">
            <h2 className="font-heading text-2xl font-bold text-content-strong">Ready to Get Started?</h2>
            <p className="text-lg text-content-secondary">
              Open the Studio to browse tokens, configure URLs, and explore the API.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/studio')}
                className="btn-primary inline-flex items-center gap-2">
                <Icon icon={faFlask} />
                Open Studio
              </button>
              <button
                type="button"
                onClick={() => navigate('/studio?editor=new')}
                className="btn-secondary inline-flex items-center gap-2">
                <Icon icon={faListUl} />
                Create a List
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
