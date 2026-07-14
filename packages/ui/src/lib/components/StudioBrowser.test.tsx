import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, useEffect, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Virtualizer mock — @tanstack/react-virtual measures real layout, which jsdom
// does not provide, so the production virtualizer mounts zero rows. We replace
// useVirtualizer with a deterministic stand-in that maps EVERY item to a
// virtual row. This lets us assert on the rows the component actually renders
// from its `tokens` prop. We do NOT change any component logic — only the
// windowing math that jsdom cannot exercise.
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_unused, index) => ({
        index,
        key: index,
        start: index * 44,
        size: 44,
      })),
    measure: () => {},
    measureElement: () => {},
  }),
}))

// ---------------------------------------------------------------------------
// Image mock — render a plain <img> so token rows do not trigger real network
// image loads or IntersectionObserver.
// ---------------------------------------------------------------------------
vi.mock('./Image', () => ({
  default: ({ src, alt }: { src: string; alt?: string }) => createElement('img', { src, alt: alt ?? '' }),
}))

// ---------------------------------------------------------------------------
// idb-keyval mock — the list editor (useLocalLists) persists lists into
// IndexedDB, which jsdom does not provide. We back it with an in-memory Map so
// createList / addToken work and we can read the persisted tokens back. Mirrors
// the pattern already used in useLocalLists.test.ts.
// ---------------------------------------------------------------------------
const idbStore = new Map<string, unknown>()
vi.mock('idb-keyval', () => ({
  get: (key: string) => Promise.resolve(idbStore.get(key)),
  set: (key: string, value: unknown) => {
    idbStore.set(key, value)
    return Promise.resolve()
  },
  del: (key: string) => {
    idbStore.delete(key)
    return Promise.resolve()
  },
  keys: () => Promise.resolve([...idbStore.keys()]),
}))

// ---------------------------------------------------------------------------
// Deterministic API base so fetch URLs are predictable in assertions.
// We only override getApiUrl; everything else in ../utils is re-exported intact.
// ---------------------------------------------------------------------------
vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    getApiUrl: (path: string) => `https://api.test${path}`,
  }
})

import StudioBrowser from './StudioBrowser'
import { StudioProvider, useStudio } from '../contexts/StudioContext'
import { ListEditorProvider, useListEditor } from '../contexts/ListEditorContext'
import { SettingsProvider } from '../contexts/SettingsContext'

// ---------------------------------------------------------------------------
// Network boundary mock. useMetrics() pulls /stats, /networks and /list; the
// browser then fetches /list/tokens/<identifier> for the selected chain.
// We route by URL so each endpoint returns its canned shape.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const STATS = [
  { chainId: '1', count: 500 },
  { chainId: '369', count: 200 },
]

const NETWORKS = [
  { type: 'evm', chainId: '1', networkId: '1' },
  { type: 'evm', chainId: '369', networkId: '369' },
]

const PROVIDERS = [
  {
    key: 'default',
    name: 'Default List',
    description: '',
    default: true,
    providerKey: 'gib',
    chainId: '1',
    chainType: 'evm',
  },
]

interface ApiToken {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  sources?: string[]
}

/** Build the /list/tokens response shape the component expects. */
function tokensResponse(chainId: number, tokens: ApiToken[]) {
  return { chainId, total: tokens.length, tokens }
}

const ETHEREUM_TOKENS: ApiToken[] = [
  {
    chainId: 1,
    address: '0xAAAa0000000000000000000000000000000000aa',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoURI: 'https://logo/weth.png',
    sources: ['gib/default'],
  },
  {
    chainId: 1,
    address: '0xBBBb0000000000000000000000000000000000bb',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    logoURI: 'https://logo/usdc.png',
    sources: ['gib/default'],
  },
  {
    chainId: 1,
    address: '0xCCCc0000000000000000000000000000000000cc',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18,
    logoURI: 'https://logo/dai.png',
    sources: ['gib/default'],
  },
]

const PULSECHAIN_TOKENS: ApiToken[] = [
  {
    chainId: 369,
    address: '0xDDDd0000000000000000000000000000000000dd',
    name: 'Pulse Token',
    symbol: 'PLS',
    decimals: 18,
    logoURI: 'https://logo/pls.png',
    sources: ['gib/default'],
  },
]

/**
 * Default router: resolves the three metrics endpoints plus the per-chain
 * token endpoint. Individual tests can override `tokenResponseByChain`.
 */
function installDefaultFetch(
  tokenResponseByChain: Record<string, unknown> = {
    'eip155-1': tokensResponse(1, ETHEREUM_TOKENS),
    'eip155-369': tokensResponse(369, PULSECHAIN_TOKENS),
  },
) {
  mockFetch.mockImplementation((input: string) => {
    const url = String(input)
    const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

    if (url.endsWith('/stats')) return ok(STATS)
    if (url.endsWith('/networks')) return ok(NETWORKS)
    if (url.endsWith('/list')) return ok(PROVIDERS)

    const match = url.match(/\/list\/tokens\/([^/?]+)/)
    if (match) {
      const identifier = match[1]
      const body = tokenResponseByChain[identifier]
      if (body) return ok(body)
      return ok(tokensResponse(0, []))
    }

    // Anything else (e.g. global search list fetches) resolves empty.
    return ok({ tokens: [] })
  })
}

// ---------------------------------------------------------------------------
// Provider stack. StudioBrowser needs React Query (token fetch + useMetrics),
// StudioProvider (chain/token selection), ListEditorProvider (action button
// behaviour) and SettingsProvider (NetworkSelect reads showTestnets).
// `bootstrap` lets a test mount a companion control that drives the contexts.
// ---------------------------------------------------------------------------
function renderBrowser(props: Partial<Parameters<typeof StudioBrowser>[0]> = {}, bootstrap: ReactNode = null) {
  const onInspectToken = props.onInspectToken ?? vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const utils = render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        SettingsProvider,
        null,
        createElement(
          StudioProvider,
          null,
          createElement(
            ListEditorProvider,
            null,
            bootstrap,
            createElement(StudioBrowser, { onInspectToken, ...props }),
          ),
        ),
      ),
    ),
  )
  return { ...utils, onInspectToken }
}

/** Type a value into the search box (one synchronous change event). */
function typeSearch(value: string) {
  const box = screen.getByPlaceholderText(/Search .* tokens/i)
  fireEvent.change(box, { target: { value } })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('StudioBrowser', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
    installDefaultFetch()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows popular chains derived from metrics when no chain is selected', async () => {
    renderBrowser()

    // getPopularChains sorts by token count: Ethereum (500) before PulseChain (200).
    expect(await screen.findByText('Ethereum')).toBeTruthy()
    expect(screen.getByText('PulseChain')).toBeTruthy()
    expect(screen.getByText('500 tokens')).toBeTruthy()
  })

  it("selecting a popular chain fetches that chain's tokens and renders them", async () => {
    renderBrowser()

    fireEvent.click(await screen.findByText('PulseChain'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('https://api.test/list/tokens/eip155-369'))
    expect(await screen.findByText('Pulse Token')).toBeTruthy()
  })

  it('renders every token returned for the selected chain', async () => {
    renderBrowser()

    fireEvent.click(await screen.findByText('Ethereum'))

    expect(await screen.findByText('Wrapped Ether')).toBeTruthy()
    expect(screen.getByText('USD Coin')).toBeTruthy()
    expect(screen.getByText('Dai Stablecoin')).toBeTruthy()
  })

  it('shows the empty state when the selected chain returns no tokens', async () => {
    installDefaultFetch({ 'eip155-1': tokensResponse(1, []) })
    renderBrowser()

    fireEvent.click(await screen.findByText('Ethereum'))

    expect(await screen.findByText('No tokens found')).toBeTruthy()
  })

  it('filters the visible tokens as the user types in the search box', async () => {
    renderBrowser()

    fireEvent.click(await screen.findByText('Ethereum'))
    await screen.findByText('Wrapped Ether')

    typeSearch('usd')

    // filterTokensBySearch keeps USD Coin (name match) and drops the others.
    await waitFor(() => expect(screen.getByText('USD Coin')).toBeTruthy())
    expect(screen.queryByText('Wrapped Ether')).toBeNull()
    expect(screen.queryByText('Dai Stablecoin')).toBeNull()
  })

  it('filters by symbol as well as name', async () => {
    renderBrowser()

    fireEvent.click(await screen.findByText('Ethereum'))
    await screen.findByText('Dai Stablecoin')

    typeSearch('WETH')

    await waitFor(() => expect(screen.getByText('Wrapped Ether')).toBeTruthy())
    expect(screen.queryByText('USD Coin')).toBeNull()
  })

  it('exposes an "Inspect token" action and calls onInspectToken when the editor is closed', async () => {
    const onInspectToken = vi.fn()
    renderBrowser({ onInspectToken })

    fireEvent.click(await screen.findByText('Ethereum'))
    await screen.findByText('Wrapped Ether')

    const inspectButtons = screen.getAllByRole('button', { name: 'Inspect token' })
    expect(inspectButtons.length).toBe(ETHEREUM_TOKENS.length)
    // No "Add to list" affordance while the editor is closed.
    expect(screen.queryByRole('button', { name: 'Add to list' })).toBeNull()

    fireEvent.click(inspectButtons[0])

    expect(onInspectToken).toHaveBeenCalledTimes(1)
    expect(onInspectToken.mock.calls[0][0]).toMatchObject({
      symbol: 'WETH',
      address: '0xAAAa0000000000000000000000000000000000aa',
    })
  })

  it('clicking a token row selects it via the studio context when the editor is closed', async () => {
    const selectToken = vi.fn()
    renderBrowser({ selectToken })

    fireEvent.click(await screen.findByText('Ethereum'))
    fireEvent.click(await screen.findByText('USD Coin'))

    expect(selectToken).toHaveBeenCalledTimes(1)
    expect(selectToken.mock.calls[0][0]).toMatchObject({ symbol: 'USDC' })
  })

  it('uses the selectChain override prop instead of the studio default', async () => {
    const selectChain = vi.fn()
    renderBrowser({ selectChain })

    fireEvent.click(await screen.findByText('Ethereum'))

    expect(selectChain).toHaveBeenCalledWith('1')
  })

  it('shows a loading indicator while the chain token request is in flight', async () => {
    // Hold the /list/tokens response open so the loading branch stays mounted.
    let releaseTokens: () => void = () => {}
    mockFetch.mockImplementation((input: string) => {
      const url = String(input)
      const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
      if (url.endsWith('/stats')) return ok(STATS)
      if (url.endsWith('/networks')) return ok(NETWORKS)
      if (url.endsWith('/list')) return ok(PROVIDERS)
      if (url.includes('/list/tokens/')) {
        return new Promise((resolve) => {
          releaseTokens = () =>
            resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve(tokensResponse(1, ETHEREUM_TOKENS)),
            })
        })
      }
      return ok({ tokens: [] })
    })

    renderBrowser()

    fireEvent.click(await screen.findByText('Ethereum'))

    expect(await screen.findByText(/Loading tokens/i)).toBeTruthy()

    releaseTokens()
    expect(await screen.findByText('Wrapped Ether')).toBeTruthy()
  })

  it('deduplicates a token that appears in multiple source lists into one row', async () => {
    // Server merges by emitting one token with multiple sources. The component
    // maps each source into listReferences and renders a single row carrying a
    // "+N" badge for the extra lists.
    const dupToken: ApiToken = {
      chainId: 1,
      address: '0xEEEe0000000000000000000000000000000000ee',
      name: 'Shared Token',
      symbol: 'SHARE',
      decimals: 18,
      logoURI: 'https://logo/share.png',
      sources: ['gib/default', 'other/list', 'third/list'],
    }
    installDefaultFetch({ 'eip155-1': tokensResponse(1, [dupToken]) })

    renderBrowser()

    fireEvent.click(await screen.findByText('Ethereum'))

    // Exactly one row for the shared token.
    const rows = await screen.findAllByText('Shared Token')
    expect(rows.length).toBe(1)
    // Two extra source lists beyond the primary → "+2" badge.
    expect(screen.getByText('+2')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Non-Ethereum-Virtual-Machine chain behaviour. A curated non-EVM network
// (Bitcoin, Solana, etc.) has a logo but no browsable tokens. `useMetrics()`
// flags this via `isEvm: false` on the resolved NetworkInfo. We drive the
// selection through the real StudioContext (mirroring OpenEditorWithList
// below) so StudioBrowser resolves `selectedNetwork` from live metrics rather
// than a prop override.
// ---------------------------------------------------------------------------

/** Test-only bootstrap: selects the given chain via the real StudioContext. */
function SelectChainOnMount({ chainId }: { chainId: string }) {
  const { selectChain } = useStudio()
  useEffect(() => {
    selectChain(chainId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

describe('StudioBrowser with a non-Ethereum-Virtual-Machine chain selected', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a logo-only empty state and hides the token grid and search box', async () => {
    mockFetch.mockImplementation((input: string) => {
      const url = String(input)
      const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

      if (url.endsWith('/stats')) return ok(STATS)
      if (url.endsWith('/networks'))
        return ok([
          ...NETWORKS,
          { type: 'bip122', chainId: '0', networkId: '0', chainIdentifier: 'bip122-0', imageHash: 'abc' },
        ])
      if (url.endsWith('/list')) return ok(PROVIDERS)
      if (url.includes('/list/tokens/')) return ok(tokensResponse(0, []))
      return ok({ tokens: [] })
    })

    renderBrowser({}, createElement(SelectChainOnMount, { chainId: 'bip122-0' }))

    expect(await screen.findByText(/no tokens to browse/i)).toBeTruthy()
    // "Bitcoin" appears both in the network selector header and the empty
    // state — assert at least one rendering rather than assuming uniqueness.
    expect(screen.getAllByText('Bitcoin').length).toBeGreaterThan(0)
    expect(screen.queryByPlaceholderText(/Search .* tokens/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Inspect token' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Editor-open behaviour. We drive the real ListEditorProvider into the open
// state with an active list using a companion control that calls the same
// hooks the component uses, then assert the action button flips to
// "Add to list" and routes clicks into the list editor instead of inspection.
// ---------------------------------------------------------------------------

/**
 * Test-only bootstrap: creates a scratch list and opens the editor on it so
 * that `editorOpen && activeList` is truthy for StudioBrowser. Renders nothing.
 */
function OpenEditorWithList() {
  const { createList, setActiveList, openNewEditor, activeList } = useListEditor()
  useEffect(() => {
    if (activeList) return
    let cancelled = false
    void (async () => {
      openNewEditor()
      const list = await createList({ name: 'Scratch', source: { type: 'scratch' } })
      if (!cancelled && list) setActiveList(list)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

describe('StudioBrowser with the list editor open', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
    idbStore.clear()
    installDefaultFetch()
  })

  afterEach(() => {
    cleanup()
  })

  it('exposes "Add to list" actions instead of "Inspect token" when an active list is open', async () => {
    const onInspectToken = vi.fn()
    renderBrowser({ onInspectToken }, createElement(OpenEditorWithList, null))

    fireEvent.click(await screen.findByText('Ethereum'))
    await screen.findByText('Wrapped Ether')

    // The action button flips to the add affordance once the editor has an
    // active list. Wait for the async createList to settle.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Add to list' }).length).toBe(ETHEREUM_TOKENS.length),
    )
    expect(screen.queryByRole('button', { name: 'Inspect token' })).toBeNull()

    // Clicking the add action must NOT inspect — it adds to the list instead.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to list' })[0])
    expect(onInspectToken).not.toHaveBeenCalled()
  })

  it('adds the clicked token to the active list and persists it', async () => {
    renderBrowser({}, createElement(OpenEditorWithList, null))

    fireEvent.click(await screen.findByText('Ethereum'))
    await screen.findByText('Wrapped Ether')
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Add to list' }).length).toBe(ETHEREUM_TOKENS.length),
    )

    // Identify the WETH row's add button and click it.
    const wethRow = screen.getByText('Wrapped Ether').closest('div.group') as HTMLElement
    const addButton = within(wethRow).getByRole('button', { name: 'Add to list' })
    fireEvent.click(addButton)

    // The token must be written into the active list's stored tokens. We assert
    // via the in-memory idb store the list editor persists into.
    await waitFor(() => {
      const listKey = [...idbStore.keys()].find((k) => k.startsWith('gib-list:'))
      expect(listKey).toBeTruthy()
      const stored = idbStore.get(listKey!) as { tokens: { symbol: string }[] }
      expect(stored.tokens.some((t) => t.symbol === 'WETH')).toBe(true)
    })
  })
})
