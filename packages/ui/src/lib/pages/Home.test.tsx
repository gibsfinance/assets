/**
 * The landing page.
 *
 * Everything on it that can be wrong is wrong quietly. The headline totals are numbers, so
 * a broken metrics fetch does not blank the page — it publishes "0 Supported Networks" or
 * leaves a placeholder up forever, both of which look like content. The network grid is a
 * row of buttons, so a button that stores the wrong chain reference still navigates, and
 * the reader only finds out when the Studio opens on the wrong chain. The integration
 * examples are the page's documentation of the endpoints, so a preview showing one asset
 * beside a link fetching another is a page that teaches the wrong URL.
 *
 * The tests are therefore built around three things: the three states of the metrics
 * fetch (in flight, answered, refused), the payload the network buttons and navigation
 * buttons carry, and the agreement between each example's preview and its link.
 *
 * Only host APIs are stubbed. jsdom supplies no ResizeObserver or IntersectionObserver,
 * lays nothing out (so the grid's own column count has to be answered through
 * getComputedStyle), and runs no animation frames worth waiting on. The network is stubbed
 * at fetch. The real query hooks, the real settings provider and the real child components
 * are all exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Home from './Home'
import { SettingsProvider } from '../contexts/SettingsContext'
import { getApiUrl } from '../utils'

// ---------------------------------------------------------------------------
// Fixtures — the two payloads useMetrics combines into the page's metrics
// ---------------------------------------------------------------------------

type ServerNetwork = {
  type: string
  chainId: string
  networkId: string
  chainIdentifier: string
  name: string | null
  title: string | null
  imageHash: string | null
}

const evmNetwork = (chainId: number, name: string, extra: Partial<ServerNetwork> = {}): ServerNetwork => ({
  type: 'evm',
  chainId: String(chainId),
  networkId: String(chainId),
  chainIdentifier: `eip155-${chainId}`,
  name,
  title: null,
  imageHash: '0xabc',
  ...extra,
})

const stat = (chainId: number, count: number) => ({
  chainId: String(chainId),
  chainIdentifier: `eip155-${chainId}`,
  count,
})

/**
 * Eight mainnets carrying tokens, one mainnet that has only a logo, and two testnets.
 *
 * The logo-only chain is what separates the "Supported Networks" headline from the set the
 * grid can draw, which is the relationship the remainder count is built on. One testnet is
 * placed second and one last on purpose: the server sends chains in no particular order,
 * so the page's own ordering has to hold whichever side of a mainnet a testnet arrives on.
 */
const NETWORKS: ServerNetwork[] = [
  evmNetwork(1, 'Ethereum Mainnet'),
  evmNetwork(11155111, 'Sepolia', { title: 'Ethereum Testnet Sepolia' }),
  evmNetwork(369, 'PulseChain'),
  evmNetwork(8453, 'Base'),
  evmNetwork(137, 'Polygon'),
  evmNetwork(10, 'OP Mainnet'),
  evmNetwork(56, 'BNB Smart Chain'),
  evmNetwork(100, 'Gnosis'),
  evmNetwork(42161, 'Arbitrum One'),
  evmNetwork(5000, 'Mantle'),
  evmNetwork(943, 'PulseChain Testnet v4'),
]

const STATS = [
  stat(1, 500),
  stat(369, 400),
  stat(8453, 300),
  stat(137, 200),
  stat(10, 100),
  stat(56, 50),
  stat(100, 25),
  stat(42161, 10),
  stat(11155111, 7),
  stat(943, 3),
]

/** Every count the server reports, testnets included — what "Total Tokens" adds up. */
const TOTAL_TOKENS = STATS.reduce((sum, entry) => sum + entry.count, 0)
/** Mainnets with either tokens or a logo — what "Supported Networks" counts. */
const MAINNET_COUNT = 9

// ---------------------------------------------------------------------------
// Host stubs
// ---------------------------------------------------------------------------

/** Answers the three endpoints useMetrics reads. */
function stubFetch({
  stats = STATS as unknown[],
  networks = NETWORKS as unknown[],
  ok = true,
}: { stats?: unknown[]; networks?: unknown[]; ok?: boolean } = {}) {
  const handler = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.endsWith('/stats') ? stats : url.endsWith('/networks') ? networks : []
    return { ok, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', handler)
  return handler
}

/** Refuses every request, the way an unreachable server does. */
function stubUnreachableServer() {
  const handler = vi.fn(async () => {
    throw new Error('connection refused')
  })
  vi.stubGlobal('fetch', handler)
  return handler
}

function stubResizeObserver() {
  class InertObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', InertObserver)
}

/** Reports every observed element as on screen, so lazy images and counters both run. */
function stubIntersectionObserver() {
  class ImmediateObserver {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.callback([{ isIntersecting: true }])
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', ImmediateObserver)
}

/**
 * Runs the requested frame at once with a timestamp far past any animation duration, so
 * the count-up counters settle on their final figures instead of being caught mid-climb.
 */
function stubAnimationFrames() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(performance.now() + 60_000)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

/**
 * Answers the grid's own column count.
 *
 * The page reads `gridTemplateColumns` off the live grid to decide how many whole rows of
 * networks it can show. jsdom applies no stylesheet, so left alone it reports a single
 * column and the row-filling logic is never exercised. Only the network grid is answered;
 * every other element keeps its real computed style.
 */
function stubGridColumns(columns: number) {
  const original = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((element: Element, pseudo?: string | null) => {
    const style = original(element, pseudo)
    if (!(element instanceof window.HTMLElement) || !element.classList.contains('grid-cols-2')) return style
    const value = Array.from({ length: columns }, () => '1fr').join(' ')
    return new Proxy(style, {
      get(target, property) {
        if (property === 'gridTemplateColumns') return value
        const found = Reflect.get(target, property)
        return typeof found === 'function' ? found.bind(target) : found
      },
    })
  }) as typeof window.getComputedStyle)
}

/** Columns wide enough that the page has to drop a partial row rather than draw one. */
const GRID_COLUMNS = 3

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Stands in for the Studio so navigation, and what it was handed, are both observable. */
function StudioProbe() {
  const location = useLocation()
  return <p>studio route{location.search}</p>
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/studio" element={<StudioProbe />} />
          </Routes>
        </MemoryRouter>
      </SettingsProvider>
    </QueryClientProvider>,
  )
  return { ...view, client }
}

/** Waits for the metrics to land, which is what swaps the skeleton for the grid. */
const waitForMetrics = () => screen.findByText('Tokens by Chain')

/** The figure shown above a metric caption, read from the counter rather than the caption. */
const metricValue = (caption: string) =>
  screen.getByText(caption).parentElement!.querySelector('.text-gradient-green')!.textContent

/** Display names of the network tiles currently drawn, in the order they appear. */
const drawnNetworks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div[title]')).map((node) => node.getAttribute('title'))

beforeEach(() => {
  localStorage.clear()
  stubResizeObserver()
  stubIntersectionObserver()
  stubAnimationFrames()
  stubGridColumns(GRID_COLUMNS)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('Home — the three states of its metrics fetch', () => {
  it('shows placeholders rather than zeros while the metrics are still in flight', () => {
    // A zero is a claim. Until the server has answered, the page has nothing to claim, and
    // printing 0 would be publishing a false total for as long as the request takes.
    stubFetch()
    renderHome()
    expect(screen.getAllByText('---')).toHaveLength(2)
    expect(screen.queryByText('Tokens by Chain')).toBeNull()
  })

  it('publishes the token total and the supported-network count once they arrive', async () => {
    stubFetch()
    const { container } = renderHome()
    await waitForMetrics()

    expect(metricValue('Total Tokens')).toBe(TOTAL_TOKENS.toLocaleString())
    expect(metricValue('Supported Networks')).toBe(String(MAINNET_COUNT))
    expect(container.querySelectorAll('div[title]').length).toBeGreaterThan(0)
  })

  it('keeps the placeholders up when the server cannot be reached at all', async () => {
    // The page has no data and says so, rather than inventing one. This is the state the
    // remainder of an outage looks like once every request has failed and settled.
    const handler = stubUnreachableServer()
    const { client } = renderHome()
    await waitFor(() => expect(client.isFetching()).toBe(0))

    expect(handler).toHaveBeenCalled()
    expect(screen.getAllByText('---')).toHaveLength(2)
    expect(screen.queryByText('Tokens by Chain')).toBeNull()
  })

  it('admits it does not know when the server answers the metrics endpoints with an error status', async () => {
    // This asserted zeros until useMetrics stopped turning a non-ok response into an empty
    // list — a change this test asked for in as many words. The page could not tell that
    // apart from a genuinely empty server, so a 500 from /stats rendered as a confident
    // "0 Supported Networks", and the placeholders below were unreachable because an empty
    // array is truthy. Zero is a claim; dashes are the truthful answer to a failed request.
    stubFetch({ ok: false })
    const { client, container } = renderHome()
    await waitFor(() => expect(client.isFetching()).toBe(0))

    expect(screen.getAllByText('---')).toHaveLength(2)
    expect(screen.queryByText('Tokens by Chain')).toBeNull()
    expect(screen.queryByText(/Could not load the network breakdown/)).not.toBeNull()
    expect(drawnNetworks(container)).toEqual([])
  })

  it('stops animating the placeholders once the request has failed for good', async () => {
    // A pulse promises the figure is still on its way. After an outage it is not, and the
    // two states are only distinguishable here because useMetrics publishes isError.
    stubFetch({ ok: false })
    const { client } = renderHome()
    await waitFor(() => expect(client.isFetching()).toBe(0))

    for (const placeholder of screen.getAllByText('---')) {
      expect(placeholder.className).not.toContain('animate-pulse')
    }
  })
})

describe('Home — the network grid', () => {
  it('draws only whole rows, most populated chain first', async () => {
    // A trailing partial row reads as a rendering fault next to the full ones above it, so
    // the page deliberately drops the remainder. Eight candidates across three columns is
    // two whole rows, not two and two thirds.
    stubFetch()
    const { container } = renderHome()
    await waitForMetrics()

    expect(drawnNetworks(container)).toEqual(['Ethereum', 'PulseChain', 'Base', 'Polygon', 'Optimism', 'BNB Smart Chain'])
  })

  it('counts the remainder against the headline total, not against the chains it drew', async () => {
    // The two numbers sit within a few hundred pixels of each other. Counting the
    // remainder against the drawable subset makes them contradict — the page would say it
    // supports nine networks and then account for only eight of them.
    stubFetch()
    renderHome()
    await waitForMetrics()

    expect(screen.getByText(`and ${MAINNET_COUNT - GRID_COLUMNS * 2} more networks`)).toBeTruthy()
  })

  it('says "network" rather than "networks" when exactly one is left over', async () => {
    stubFetch({
      networks: [
        evmNetwork(1, 'Ethereum Mainnet'),
        evmNetwork(369, 'PulseChain'),
        evmNetwork(8453, 'Base'),
        evmNetwork(5000, 'Mantle'),
      ],
      stats: [stat(1, 30), stat(369, 20), stat(8453, 10)],
    })
    renderHome()
    await waitForMetrics()

    expect(screen.getByText('and 1 more network')).toBeTruthy()
  })

  it('says nothing about a remainder when it drew everything it supports', async () => {
    stubFetch({
      networks: [evmNetwork(1, 'Ethereum Mainnet'), evmNetwork(369, 'PulseChain'), evmNetwork(8453, 'Base')],
      stats: [stat(1, 30), stat(369, 20), stat(8453, 10)],
    })
    renderHome()
    await waitForMetrics()

    expect(screen.queryByText(/more network/)).toBeNull()
  })

  it('hides testnets until the reader asks for them', async () => {
    stubFetch()
    const { container } = renderHome()
    await waitForMetrics()
    expect(drawnNetworks(container)).not.toContain('Sepolia')

    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(drawnNetworks(container)).toContain('Sepolia'))
    // Mainnets keep the front of the grid even though the server sent this testnet second,
    // so no testnet can displace a real chain out of the visible rows.
    const names = drawnNetworks(container)
    expect(names.indexOf('Sepolia')).toBeGreaterThan(names.indexOf('Arbitrum One'))
  })

  it('takes a repeated failure report from one chain as the single failure it is', async () => {
    // A tile can report failure twice: each one gives up on an image that never resolves
    // after ten seconds, and the image can still fire its own error afterwards. The set of
    // failed chains is what the visible rows are derived from, so rebuilding it for a chain
    // already in it would reshuffle the whole grid on a duplicate.
    stubFetch()
    const { container } = renderHome()
    await waitForMetrics()
    const logo = screen.getByAltText('Base')

    act(() => {
      logo.dispatchEvent(new Event('error'))
      logo.dispatchEvent(new Event('error'))
    })

    await waitFor(() => expect(drawnNetworks(container)).not.toContain('Base'))
    expect(drawnNetworks(container)).toHaveLength(GRID_COLUMNS * 2)
  })

  it('remembers the testnet choice, so it survives leaving the page', async () => {
    stubFetch()
    renderHome()
    await waitForMetrics()
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(localStorage.getItem('showTestnets')).toBe('true'))
  })

  it('drops a chain whose logo will not load and fills the row from the next one', async () => {
    // A tile whose image 404s is a broken-looking hole in an otherwise polished grid, and
    // there are always a few. Removing it must also re-close the row, or the page trades a
    // broken image for a gap.
    stubFetch()
    const { container } = renderHome()
    await waitForMetrics()
    expect(drawnNetworks(container)).toContain('Base')

    act(() => {
      fireEvent.error(screen.getByAltText('Base'))
    })

    await waitFor(() => expect(drawnNetworks(container)).not.toContain('Base'))
    const names = drawnNetworks(container)
    expect(names).toHaveLength(GRID_COLUMNS * 2)
    expect(names).toContain('Gnosis Chain')
  })

  it('shows a placeholder block in place of the grid until the metrics land', () => {
    stubFetch()
    const { container } = renderHome()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
    expect(drawnNetworks(container)).toEqual([])
  })
})

describe('Home — where its controls take the reader', () => {
  it('hands the Studio the namespaced identifier, not the bare chain number', async () => {
    // The bare number cannot tell Solana's 501 from an Ethereum-Virtual-Machine chain 501.
    // Storing it opens the Studio on a different chain than the one that was pressed, with
    // nothing anywhere reporting a mistake.
    stubFetch()
    const { container } = renderHome()
    await waitForMetrics()

    // Scoped to the grid: the credits row above it also titles a link "PulseChain".
    fireEvent.click(container.querySelector('div[title="PulseChain"]')!.closest('button')!)

    expect(localStorage.getItem('selectedChainId')).toBe('eip155-369')
    expect(screen.getByText(/studio route/)).toBeTruthy()
  })

  it('opens the Studio plainly from the primary call to action', async () => {
    stubFetch()
    renderHome()
    await waitForMetrics()

    fireEvent.click(screen.getByRole('button', { name: /Open Studio/ }))

    expect(screen.getByText('studio route').textContent).toBe('studio route')
  })

  it('opens the Studio straight into a new list from the secondary call to action', async () => {
    // The two buttons differ only by that query parameter, so losing it silently demotes
    // "Create a List" into a second copy of "Open Studio".
    stubFetch()
    renderHome()
    await waitForMetrics()

    fireEvent.click(screen.getByRole('button', { name: /Create a List/ }))

    expect(screen.getByText(/studio route/).textContent).toBe('studio route?editor=new')
  })
})

describe('Home — the integration examples', () => {
  const exampleUrls = [
    getApiUrl('/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    getApiUrl('/image/eip155-1'),
    getApiUrl('/list/coingecko'),
  ]

  it('links each example at the endpoint it documents, opened safely', () => {
    stubFetch()
    renderHome()

    for (const url of exampleUrls) {
      const link = screen.getByText(url).closest('a')!
      expect(link.getAttribute('href')).toBe(url)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.getAttribute('rel')).toContain('noreferrer')
    }
  })

  it('previews the very asset each example URL fetches', () => {
    // The preview is the page's evidence that the endpoint works. Showing an image from a
    // different address beside the sample URL would demonstrate nothing, and would read as
    // working either way.
    stubFetch()
    renderHome()

    const tokenExample = exampleUrls[0]
    expect(screen.getByAltText('WBTC Token').getAttribute('src')!.startsWith(tokenExample)).toBe(true)
    expect(screen.getByAltText('Ethereum').getAttribute('src')!.startsWith(exampleUrls[1])).toBe(true)
  })

  it('shows a shortened path in the sample rather than the whole absolute URL', () => {
    // The samples are read at a glance; the full origin pushes the interesting part of the
    // path off the line.
    stubFetch()
    renderHome()

    expect(screen.getByText('/list/coingecko')).toBeTruthy()
  })

  it('shows the three token logos the list example is illustrated with', () => {
    stubFetch()
    renderHome()

    expect(screen.getByAltText('Token 1')).toBeTruthy()
    expect(screen.getByAltText('Token 2')).toBeTruthy()
    expect(screen.getByAltText('Token 3')).toBeTruthy()
  })
})
