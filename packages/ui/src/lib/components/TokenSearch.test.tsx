/**
 * The search box above the token browser, plus the token-list filter it embeds.
 *
 * Two independent dimensions meet here and neither one announces itself when it breaks:
 *
 *  - The text query. Every keystroke is echoed straight back to the parent so the
 *    already-loaded chain list can be narrowed locally, and separately a debounced
 *    search of every chain runs against `/list/search` so a token the current chain has
 *    never heard of can still be found. If the echo stops, typing filters nothing. If
 *    the debounce stops, either every keystroke hits the endpoint or the search never
 *    happens at all — both are silent. The search itself is covered in
 *    `useTokenSearch.test.ts`; what is asserted here is that this box drives it and
 *    stays usable while it runs.
 *  - The chain filter. The count beside the funnel is the number of lists that hold a
 *    token on the selected chain. If the selected chain stops reaching the filter, the
 *    count freezes at whatever it last showed and the user is filtering by a chain they
 *    are no longer looking at.
 *
 * The component reaches the network only through `fetch`, which stands for the search
 * endpoint alone. Nothing in the application is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import TokenSearch from './TokenSearch'
import { getApiUrl } from '../utils'
import type { SearchUpdate, Token } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAI = {
  chainId: 1,
  chainIdentifier: 'eip155-1',
  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  name: 'Dai Stablecoin',
  symbol: 'DAI',
  decimals: 18,
  logoURI: 'https://logo/dai.png',
  sources: ['uniswap/default'],
}

const SEARCH_URL = getApiUrl('/list/search')

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

let fetchMock: ReturnType<typeof vi.fn>

/** URLs the component asked for, in order. */
const requestedUrls = () => fetchMock.mock.calls.map((call) => String(call[0]))

type Overrides = {
  count?: number
  selectedChain?: number | null
  enabledLists?: Set<string>
  tokensByList?: Map<string, Token[]>
}

function renderSearch(overrides: Overrides = {}) {
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

  const view = render(<TokenSearch {...props} />)

  /** Re-render with a changed prop, keeping the same callbacks. */
  const rerenderWith = (next: Partial<typeof props>) => view.rerender(<TokenSearch {...props} {...next} />)

  return { ...view, updates, rerenderWith, onToggleList, onToggleAll }
}

const searchBox = () => screen.getByPlaceholderText(/tokens\.\.\.$/) as HTMLInputElement

const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })

/** Push past the debounce window and let the request settle. */
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
  fetchMock = vi.fn(async () => jsonResponse({ query: '', truncated: false, tokens: [DAI] }))
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
    // previous search's results are not left standing under a new query.
    const { updates } = renderSearch()
    type('dai')

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      query: 'dai',
      isSearching: false,
      isError: false,
      truncated: false,
      tokens: [],
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('holds the request back until typing pauses', async () => {
    renderSearch()
    type('dai')

    await runPendingSearch(499)
    expect(fetchMock).not.toHaveBeenCalled()

    await runPendingSearch(1)
    expect(requestedUrls()).toEqual([`${SEARCH_URL}?q=dai`])
  })

  it('collapses a burst of keystrokes into a single request', async () => {
    renderSearch()
    type('d')
    await runPendingSearch(200)
    type('da')
    await runPendingSearch(200)
    type('dai')
    await runPendingSearch()

    expect(requestedUrls()).toEqual([`${SEARCH_URL}?q=dai`])
  })

  it('answers a whole query with one request instead of a list-per-provider fan-out', async () => {
    // The reason the endpoint exists. This box used to download every provider list —
    // 1,193 of them, hundreds of megabytes — and filter them in the browser.
    renderSearch()
    type('dai')
    await runPendingSearch()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requestedUrls().every((url) => url.startsWith(SEARCH_URL))).toBe(true)
  })

  it('cancels the pending request when the query is cleared', async () => {
    const { updates } = renderSearch()
    type('dai')
    await runPendingSearch(200)
    type('')
    await runPendingSearch(2000)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(updates.at(-1)).toMatchObject({ query: '', tokens: [] })
  })

  it('does not search for a query that is only whitespace', async () => {
    renderSearch()
    type('   ')
    await runPendingSearch(2000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not search for a single character the endpoint would reject', async () => {
    // Two characters is the server's minimum; one would come back 400, which reads
    // downstream as a failed search rather than as a term that is simply too short.
    renderSearch()
    type('d')
    await runPendingSearch(2000)
    expect(fetchMock).not.toHaveBeenCalled()

    type('da')
    await runPendingSearch()
    expect(requestedUrls()).toEqual([`${SEARCH_URL}?q=da`])
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

  it('accepts keystrokes while a search is still running', async () => {
    // Regression guard. The change handler used to return early while a search was in
    // flight, and nothing lowered that flag when the search finished — so the very first
    // search permanently froze the controlled input. The user could neither refine the
    // query nor clear it, and the parent stayed filtered to a term nobody could edit.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async () => {
      await held
      return jsonResponse({ query: 'usd', truncated: false, tokens: [DAI] })
    })

    renderSearch()
    type('usd')
    await runPendingSearch()

    type('usdc')
    expect(searchBox().value).toBe('usdc')

    await act(async () => {
      release()
      await vi.advanceTimersByTimeAsync(0)
    })
    await runPendingSearch()
    expect(requestedUrls()).toEqual([`${SEARCH_URL}?q=usd`, `${SEARCH_URL}?q=usdc`])
  })

  it('leaves the box usable after a search fails', async () => {
    // A failed search must not be a dead end: the term that failed is the one the user
    // most wants to edit.
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const { updates, container } = renderSearch()

    type('dai')
    await runPendingSearch()
    expect(updates.at(-1)).toMatchObject({ isError: true, isSearching: false })
    expect(container.querySelector('.fa-spinner')).toBeNull()

    type('daix')
    expect(searchBox().value).toBe('daix')
  })

  it('accumulates successive keystrokes into the query the caller sees', async () => {
    const { updates } = renderSearch()
    type('u')
    type('us')
    type('usd')
    expect(searchBox().value).toBe('usd')
    expect(updates.map((update) => update.query)).toEqual(['u', 'us', 'usd'])
  })

  it('spins only while a search is in flight', async () => {
    // The spinner has to come back down when the work is done, or a finished search
    // reads as one that never returned.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async () => {
      await held
      return jsonResponse({ query: 'dai', truncated: false, tokens: [DAI] })
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

  it('hands the results straight through to the caller', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ query: 'dai', truncated: true, tokens: [DAI] }))
    const { updates } = renderSearch()

    type('dai')
    await runPendingSearch()

    expect(updates.at(-1)).toMatchObject({ query: 'dai', truncated: true, isSearching: false })
    expect(updates.at(-1)!.tokens.map((token) => token.symbol)).toEqual(['DAI'])
  })

  it('names the number of tokens in scope on the box itself', () => {
    renderSearch({ count: 1234 })
    expect(screen.getByPlaceholderText('Search 1234 tokens...')).toBeTruthy()
  })
})

describe('TokenSearch — the chain filter it embeds', () => {
  const listA: Token[] = [{ ...DAI, hasIcon: true, sourceList: 'a' }]
  const listB: Token[] = [
    {
      chainId: 369,
      address: '0x0000000000000000000000000000000000000369',
      name: 'USD Coin from Ethereum',
      symbol: 'USDC',
      decimals: 6,
      hasIcon: true,
      sourceList: 'b',
    },
  ]
  const listC: Token[] = [
    {
      chainId: 1,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      hasIcon: true,
      sourceList: 'c',
    },
  ]
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
    // the query searches all of them. A query must not narrow the filter's count, or
    // the user loses lists from the filter panel just by typing.
    const { container } = renderSearch({ tokensByList, selectedChain: 1 })
    type('usd')
    await runPendingSearch()
    expect(filterCount(container)).toBe('2')
  })
})
