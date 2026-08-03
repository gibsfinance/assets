/**
 * The search box above the token browser, plus the token-list filter it embeds.
 *
 * Two independent dimensions meet here and neither one announces itself when it breaks:
 *
 *  - The text query. Every keystroke is echoed straight back to the parent so the
 *    already-loaded chain list can be narrowed locally, and separately a debounced
 *    global search fans out across every provider list so a token the current chain
 *    has never heard of can still be found. If the echo stops, typing filters nothing.
 *    If the debounce stops, either every keystroke fans out across dozens of list
 *    endpoints or the fan-out never happens at all — both are silent.
 *  - The chain filter. The count beside the funnel is the number of lists that hold a
 *    token on the selected chain. If the selected chain stops reaching the filter, the
 *    count freezes at whatever it last showed and the user is filtering by a chain they
 *    are no longer looking at.
 *
 * The component reaches the network only through `fetch`, and reads providers, networks
 * and per-chain counts through react-query. The query cache is seeded directly so those
 * three reads resolve without a round trip, leaving `fetch` to stand for the list
 * endpoints alone. Nothing in the application is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TokenSearch from './TokenSearch'
import { getApiUrl } from '../utils'
import type { ListDescription, Network, SearchUpdate, Token } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Providers as the server describes them. `chainId: '0'` marks a multi-chain list. */
const PROVIDERS: ListDescription[] = [
  {
    key: 'default',
    name: 'Uniswap default',
    description: '',
    default: true,
    providerKey: 'uniswap',
    chainId: '0',
    chainType: 'evm',
  },
  {
    key: 'tokens',
    name: 'PulseChain bridge',
    description: '',
    default: false,
    providerKey: 'pulsechain-bridge',
    chainId: '369',
    chainType: 'evm',
  },
  // Deliberately not an Ethereum-Virtual-Machine list: addresses there are base58, so
  // fanning the search out to it would search a namespace the results cannot represent.
  {
    key: 'coins',
    name: 'Solana',
    description: '',
    default: false,
    providerKey: 'solana',
    chainId: '501',
    chainType: 'solana',
  },
]

const NETWORKS: Network[] = [
  { type: 'evm', chainId: '1', networkId: '1', chainIdentifier: 'eip155-1', name: 'Ethereum Mainnet', title: null, imageHash: 'a' },
  { type: 'evm', chainId: '369', networkId: '369', chainIdentifier: 'eip155-369', name: 'PulseChain', title: null, imageHash: 'b' },
]

const STATS = [
  { chainId: '1', chainIdentifier: 'eip155-1', count: 400 },
  { chainId: '369', chainIdentifier: 'eip155-369', count: 120 },
]

const DAI = { chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'Dai Stablecoin', symbol: 'DAI', decimals: 18 }
const USDC = { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USD Coin', symbol: 'USDC', decimals: 6 }
/** On a chain absent from /networks, so its display name has to fall back. */
const BASE_USD = { chainId: 8453, address: '0x0000000000000000000000000000000000000042', name: 'Base Dollar', symbol: 'bUSD', decimals: 18 }
/** Same address and chain as USDC — a genuine duplicate across two lists. */
const USDC_AGAIN = { ...USDC, address: USDC.address.toLowerCase() }
const BRIDGED_USDC = { chainId: 369, address: '0x0000000000000000000000000000000000000369', name: 'USD Coin from Ethereum', symbol: 'USDC', decimals: 6 }

const GLOBAL_LIST_URL = getApiUrl('/list/uniswap/default')
const CHAIN_LIST_URL = getApiUrl('/list/pulsechain-bridge/tokens')
const SOLANA_LIST_URL = getApiUrl('/list/solana/coins')

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

let fetchMock: ReturnType<typeof vi.fn>

/** URLs the component asked for, in order. */
const requestedUrls = () => fetchMock.mock.calls.map((call) => String(call[0]))

type Overrides = {
  providers?: ListDescription[]
  count?: number
  selectedChain?: number | null
  enabledLists?: Set<string>
  tokensByList?: Map<string, Token[]>
}

function renderSearch(overrides: Overrides = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  })
  queryClient.setQueryData(['providers'], overrides.providers ?? PROVIDERS)
  queryClient.setQueryData(['networks'], NETWORKS)
  queryClient.setQueryData(['stats'], STATS)

  const updates: SearchUpdate[] = []
  const onToggleList = vi.fn()
  const onToggleAll = vi.fn()

  const props = {
    onSearchUpdate: (state: SearchUpdate) => {
      updates.push(state)
    },
    count: overrides.count ?? 512,
    selectedChain: overrides.selectedChain === undefined ? 1 : overrides.selectedChain,
    enabledLists: overrides.enabledLists ?? new Set<string>(),
    tokensByList: overrides.tokensByList ?? new Map<string, Token[]>(),
    onToggleList,
    onToggleAll,
  }

  const view = render(
    <QueryClientProvider client={queryClient}>
      <TokenSearch {...props} />
    </QueryClientProvider>,
  )

  /** Re-render with a changed prop, keeping the same cache and callbacks. */
  const rerenderWith = (next: Partial<typeof props>) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <TokenSearch {...props} {...next} />
      </QueryClientProvider>,
    )

  return { ...view, updates, rerenderWith, onToggleList, onToggleAll }
}

const searchBox = () => screen.getByPlaceholderText(/tokens\.\.\.$/) as HTMLInputElement

const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })

/** Push past the debounce window and let every list request settle. */
const runPendingSearch = async (ms = 500) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn(async (url: unknown) => {
    const target = String(url)
    if (target === GLOBAL_LIST_URL) return jsonResponse({ tokens: [DAI, USDC, BASE_USD] })
    if (target === CHAIN_LIST_URL) return jsonResponse({ tokens: [BRIDGED_USDC, USDC_AGAIN] })
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('TokenSearch — typing and debouncing', () => {
  it('tells the caller what was typed before any network work begins', async () => {
    // This echo is what narrows the already-loaded chain list. It has to be
    // synchronous with the keystroke, and it has to carry an empty result set so a
    // previous global search's results are not left standing under a new query.
    const { updates } = renderSearch()
    type('dai')

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      query: 'dai',
      isSearching: false,
      isGlobalSearching: false,
      isError: false,
      tokens: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('holds the fan-out back until typing pauses', async () => {
    // Every provider list is a separate request. Firing on each keystroke would turn a
    // six-character word into six full fan-outs across every list the server publishes.
    renderSearch()
    type('dai')

    await runPendingSearch(499)
    expect(fetchMock).not.toHaveBeenCalled()

    await runPendingSearch(1)
    expect(requestedUrls()).toContain(GLOBAL_LIST_URL)
  })

  it('collapses a burst of keystrokes into a single fan-out', async () => {
    renderSearch()
    type('d')
    await runPendingSearch(200)
    type('da')
    await runPendingSearch(200)
    type('dai')
    await runPendingSearch()

    expect(requestedUrls().filter((url) => url === GLOBAL_LIST_URL)).toHaveLength(1)
  })

  it('cancels the pending fan-out when the query is cleared', async () => {
    // Clearing the box means "show me everything again". Letting the queued search run
    // would fan out across every list for an empty term, which matches every token.
    const { updates } = renderSearch()
    type('dai')
    await runPendingSearch(200)
    type('')
    await runPendingSearch(2000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(updates.at(-1)).toMatchObject({ query: '', tokens: [] })
  })

  it('does not fan out for a query that is only whitespace', async () => {
    renderSearch()
    type('   ')
    await runPendingSearch(2000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('abandons a queued search when the box unmounts', async () => {
    // Switching chains unmounts this component. A search that survived would resolve
    // into a caller that has moved on and overwrite the new chain's state.
    const { unmount } = renderSearch()
    type('dai')
    await runPendingSearch(200)
    unmount()
    await runPendingSearch(2000)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps accepting keystrokes after a search has completed', async () => {
    // Regression guard. `isGlobalSearching` gates the change handler, and nothing used
    // to lower it once a search finished — so the very first search permanently froze
    // the controlled input. The user could neither refine the query nor clear it, and
    // the parent stayed filtered to a term that could no longer be edited.
    renderSearch()
    type('usd')
    await runPendingSearch()

    type('usdc')
    expect(searchBox().value).toBe('usdc')

    await runPendingSearch()
    expect(requestedUrls().filter((url) => url === GLOBAL_LIST_URL)).toHaveLength(2)
  })

  it('accumulates successive keystrokes into the query the caller sees', async () => {
    const { updates } = renderSearch()
    type('u')
    type('us')
    type('usd')
    expect(searchBox().value).toBe('usd')
    expect(updates.map((update) => update.query)).toEqual(['u', 'us', 'usd'])
  })

  it('spins only while a fan-out is in flight', async () => {
    // Held open on the first list so the in-flight state can be observed, then released.
    // The spinner has to come back down when the work is done, or a finished search
    // reads as one that never returned.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === GLOBAL_LIST_URL) {
        await held
        return jsonResponse({ tokens: [DAI] })
      }
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const { container } = renderSearch()
    expect(container.querySelector('.fa-spinner')).toBeNull()

    type('dai')
    await runPendingSearch()
    expect(container.querySelector('.fa-spinner')).toBeTruthy()

    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.querySelector('.fa-spinner')).toBeNull()
  })

  it('names the number of tokens in scope on the box itself', () => {
    renderSearch({ count: 1234 })
    expect(screen.getByPlaceholderText('Search 1234 tokens...')).toBeTruthy()
  })
})

describe('TokenSearch — the global fan-out', () => {
  it('matches on name, symbol or address and drops everything else', async () => {
    const { updates } = renderSearch()
    type('usd')
    await runPendingSearch()

    const names = updates.at(-1)!.tokens.map((token) => token.name)
    // "USD Coin" matches on name, "bUSD" only on symbol; Dai matches on neither.
    expect(names).toContain('USD Coin')
    expect(names).toContain('Base Dollar')
    expect(names).not.toContain('Dai Stablecoin')
  })

  it('finds a token by address alone', async () => {
    const { updates } = renderSearch()
    type(DAI.address.toLowerCase())
    await runPendingSearch()

    expect(updates.at(-1)!.tokens.map((token) => token.symbol)).toEqual(['DAI'])
  })

  it('stamps each hit with the list it came from and the chain it lives on', async () => {
    // Without the source list a result cannot be attributed, and without the chain name
    // two same-symbol tokens on different chains are indistinguishable in the list.
    const { updates } = renderSearch()
    type('dai')
    await runPendingSearch()

    expect(updates.at(-1)!.tokens[0]).toMatchObject({
      symbol: 'DAI',
      sourceList: 'uniswap/default',
      chainName: 'Ethereum',
      hasIcon: true,
    })
  })

  it('falls back to a numbered chain label when the network is unknown to us', async () => {
    const { updates } = renderSearch()
    type('bUSD')
    await runPendingSearch()

    const hit = updates.at(-1)!.tokens.find((token) => token.symbol === 'bUSD')!
    expect(hit.chainName).toBe('Chain 8453')
  })

  it('searches every chain, not just the one being browsed', async () => {
    // This is the whole point of the fan-out: the chain-local list has already been
    // filtered client-side by the time the user resorts to typing. Restricting the
    // fan-out to the selected chain would make it a slower copy of the local filter.
    const { updates } = renderSearch({ selectedChain: 1 })
    type('bUSD')
    await runPendingSearch()

    expect(updates.at(-1)!.tokens.map((token) => token.chainId)).toContain(8453)
  })

  it('skips lists whose namespace cannot hold these addresses', async () => {
    renderSearch()
    type('usd')
    await runPendingSearch()

    expect(requestedUrls()).not.toContain(SOLANA_LIST_URL)
    expect(requestedUrls()).toContain(CHAIN_LIST_URL)
  })

  it('presents the accumulated results deduplicated and Ethereum first', async () => {
    // Both lists carry the same Ethereum USD Coin, spelled with different address
    // casing. Two identical rows in a search result look like two different tokens.
    // The ordering matters for the same reason a chain picker leads with Ethereum:
    // it is the chain most addresses are looked up on.
    const { updates } = renderSearch()
    type('usd')
    await runPendingSearch()

    const sorted = updates.filter((update) => update.isSearching && update.tokens.length > 1).at(-1)!
    const keys = sorted.tokens.map((token) => `${token.chainId}-${token.address.toLowerCase()}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(sorted.tokens.filter((token) => token.chainId === 1).length).toBeGreaterThan(0)
    expect(sorted.tokens[0].chainId).toBe(1)
    expect(sorted.tokens.at(-1)!.chainId).not.toBe(1)
  })

  it('reports an error rather than an empty result when no lists are known', async () => {
    // An empty provider set means the providers endpoint failed, not that the token
    // does not exist. Reporting "no matches" there tells the user something false.
    const { updates } = renderSearch({ providers: [] })
    type('dai')
    await runPendingSearch()

    expect(updates.at(-1)).toMatchObject({
      query: 'dai',
      isError: true,
      isSearching: false,
      isGlobalSearching: false,
      tokens: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an empty result set, without an error, when nothing matches', async () => {
    const { updates } = renderSearch()
    type('nothingmatchesthis')
    await runPendingSearch()

    expect(updates.at(-1)).toMatchObject({ tokens: [], isError: false, isSearching: false })
  })

  it('keeps the results from the lists that answered when one list fails', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === GLOBAL_LIST_URL) return { ok: false, status: 500, json: async () => ({}) }
      if (String(url) === CHAIN_LIST_URL) return jsonResponse({ tokens: [BRIDGED_USDC] })
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const { updates } = renderSearch()
    type('usd')
    await runPendingSearch()

    expect(updates.at(-1)!.tokens.map((token) => token.chainId)).toEqual([369])
    expect(updates.at(-1)!.isError).toBe(false)
  })

  it('survives a list whose payload carries no token array', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === GLOBAL_LIST_URL) return jsonResponse({ name: 'broken' })
      if (String(url) === CHAIN_LIST_URL) return jsonResponse({ tokens: null })
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const { updates } = renderSearch()
    type('usd')
    await runPendingSearch()

    expect(updates.at(-1)).toMatchObject({ tokens: [], isSearching: false, isError: false })
  })

  it('survives a list that throws instead of answering', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === GLOBAL_LIST_URL) throw new Error('connection reset')
      if (String(url) === CHAIN_LIST_URL) throw new Error('connection reset')
      return { ok: false, status: 404, json: async () => ({}) }
    })

    const { updates } = renderSearch()
    type('usd')
    await runPendingSearch()

    expect(updates.at(-1)).toMatchObject({ tokens: [], isSearching: false })
    consoleError.mockRestore()
  })

  it('walks away quietly when a search is superseded mid-fan-out', async () => {
    // A superseded search must not publish anything. Emitting its empty tail would wipe
    // out the results the newer search is in the middle of gathering — the user watches
    // matches appear and then vanish for no visible reason.
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    fetchMock.mockImplementation(async () => {
      throw aborted
    })

    const { updates, container } = renderSearch()
    type('usd')
    await runPendingSearch()

    expect(updates.at(-1)).toMatchObject({ isSearching: true, isGlobalSearching: true })
    // The flag still has to come down, or the box stays frozen behind a dead spinner.
    expect(container.querySelector('.fa-spinner')).toBeNull()
  })

  it('keeps what it had already gathered when a later list is superseded', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url) === GLOBAL_LIST_URL) return jsonResponse({ tokens: [DAI] })
      throw aborted
    })

    const { updates } = renderSearch()
    type('dai')
    await runPendingSearch()

    expect(updates.at(-1)!.tokens.map((token) => token.symbol)).toEqual(['DAI'])
  })

  it('marks a bridged list so the interface can label where the token came from', async () => {
    const { updates } = renderSearch()
    type('usd')
    await runPendingSearch()

    const bridged = updates.at(-1)!.tokens.find((token) => token.chainId === 369)!
    expect(bridged.isBridgeToken).toBe(true)
    const native = updates.at(-1)!.tokens.find((token) => token.sourceList === 'uniswap/default')!
    expect(native.isBridgeToken).toBe(false)
  })
})

describe('TokenSearch — the chain filter it embeds', () => {
  const listA: Token[] = [{ ...DAI, hasIcon: true, sourceList: 'a' }]
  const listB: Token[] = [{ ...BRIDGED_USDC, hasIcon: true, sourceList: 'b' }]
  const listC: Token[] = [{ ...USDC, hasIcon: true, sourceList: 'c' }]
  const tokensByList = new Map<string, Token[]>([
    ['uniswap/default', listA],
    ['pulsechain-bridge/tokens', listB],
    ['coingecko/all', listC],
  ])

  const filterCount = (container: HTMLElement) =>
    container.querySelector('.fa-filter')!.nextElementSibling!.textContent

  it('counts only the lists holding a token on the chain being browsed', () => {
    const { container } = renderSearch({ tokensByList, selectedChain: 1 })
    expect(filterCount(container)).toBe('2')
  })

  it('recounts when the browsed chain changes', () => {
    // The silent failure: the selected chain stops reaching the filter, the badge keeps
    // showing the previous chain's number, and the user filters against a stale set.
    const { container, rerenderWith } = renderSearch({ tokensByList, selectedChain: 1 })
    expect(filterCount(container)).toBe('2')

    rerenderWith({ selectedChain: 369 })
    expect(filterCount(container)).toBe('1')
  })

  it('counts nothing when no chain is selected', () => {
    const { container } = renderSearch({ tokensByList, selectedChain: null })
    expect(filterCount(container)).toBe('0')
  })

  it('leaves the chain filter alone while a text query runs', async () => {
    // The two are orthogonal by design: the filter scopes the locally loaded lists,
    // the query fans out across all of them. A query must not narrow the filter's
    // count, or the user loses lists from the filter panel just by typing.
    const { container } = renderSearch({ tokensByList, selectedChain: 1 })
    type('usd')
    await runPendingSearch()
    expect(filterCount(container)).toBe('2')
  })
})
