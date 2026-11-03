import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return { ...actual, getApiUrl: (path: string) => `https://api.test${path}` }
})

import { useChainTokens, shapeTokens, FIRST_SCREEN_TOKEN_COUNT } from './useChainTokens'
import { COMPACT_TOKEN_QUERY } from '../utils/compact-tokens'
import { compactBody } from '../../../tests/compact-body'

/** One QueryClient per render so tests never share cache — except where asserted. */
function createWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
}

const respondWith = (body: unknown) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })

const SOLANA_RESPONSE = compactBody(
  501,
  [
    {
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      sources: ['jupiter/tag-strict', 'coingecko/solana-501'],
    },
  ],
  { total: 9633 },
)

// Braces matter: mockReset returns the mock, and a function returned from a hook is run as its cleanup.
beforeEach(() => {
  mockFetch.mockReset()
})

describe('useChainTokens', () => {
  it('requests the chain by its namespaced identifier', async () => {
    respondWith(SOLANA_RESPONSE)
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))
    expect(mockFetch).toHaveBeenCalledWith(`https://api.test/list/tokens/solana-501?${COMPACT_TOKEN_QUERY}`)
    expect(result.current.total).toBe(9633)
  })

  /*
   * The response carries only the bare number, which names no namespace — 501 is
   * Solana's and Columbus testnet's alike. Stamping each token with the
   * identifier it was fetched under is what keeps its image URL resolvable.
   */
  it('stamps every token with the identifier it was fetched under', async () => {
    respondWith(SOLANA_RESPONSE)
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))

    const [token] = result.current.tokens
    expect(token.chainIdentifier).toBe('solana-501')
    expect(token.listReferences?.[0].imageUri).toBe(
      'https://api.test/image/solana-501/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    )
  })

  it('derives hasIcon and the primary source list from the response', async () => {
    respondWith(SOLANA_RESPONSE)
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))

    const [token] = result.current.tokens
    expect(token.hasIcon).toBe(true)
    expect(token.sourceList).toBe('jupiter/tag-strict')
    expect(token.listReferences).toHaveLength(2)
  })

  // A bare id and its identifier name one chain. Keying the cache on the
  // caller's spelling would fetch the same list twice and let the Studio page
  // and the browser panel disagree about what is loaded.
  it('shares one cache entry between the bare id and the identifier', async () => {
    respondWith(SOLANA_RESPONSE)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = createWrapper(client)

    const bare = renderHook(() => useChainTokens('369'), { wrapper })
    await waitFor(() => expect(bare.result.current.tokens).toHaveLength(1))
    const prefixed = renderHook(() => useChainTokens('eip155-369'), { wrapper })
    await waitFor(() => expect(prefixed.result.current.tokens).toHaveLength(1))

    // One full request and one first-screen request: two, not four.
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenCalledWith(`https://api.test/list/tokens/eip155-369?${COMPACT_TOKEN_QUERY}`)
  })

  it('fetches nothing and reports empty while no chain is chosen', async () => {
    respondWith(SOLANA_RESPONSE)
    const { result } = renderHook(() => useChainTokens(null), { wrapper: createWrapper() })
    expect(result.current.tokens).toEqual([])
    expect(result.current.total).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // A token the server lists without sources must not fall over —
  // `merged` is what every other reader (badges, snippets) expects when no
  // provider claims a token, and a stray `listReferences` array with nothing
  // in it would have those readers rendering an empty attribution list.
  it('falls back to "merged" with no list references for a sourceless token', async () => {
    respondWith(
      compactBody(501, [
        { address: 'SourcelessToken1111111111111111111111111', name: 'No Source Token', symbol: 'NST', decimals: 9 },
      ]),
    )
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))

    const [token] = result.current.tokens
    expect(token.sourceList).toBe('merged')
    expect(token.listReferences).toBeUndefined()
  })

  // The endpoint returns only tokens that have a logo (buildTokensByChainResponse
  // filters on logoURI), so the compact body leaves the logo out and every row has one.
  it('marks every token as having an icon', async () => {
    respondWith(compactBody(501, [tokenNamed('AAA')]))
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))
    expect(result.current.tokens[0].hasIcon).toBe(true)
  })

  // A server that ignored format=compact must surface as a failed load, not as
  // rows with empty names.
  it('reports an empty list when the server answers with the default body', async () => {
    respondWith({ chainId: 501, total: 1, tokens: [{ address: 'A', name: 'A', symbol: 'A', decimals: 1 }] })
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.tokens).toEqual([])
  })

  // A failed request must leave the Studio with an empty, unbroken token list
  // rather than an unhandled rejection — the page still has to render the
  // rest of the chain's controls with nothing selected.
  it('reports an empty token list rather than throwing when the request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.tokens).toEqual([])
    expect(result.current.total).toBeNull()
  })
})

/** A promise a test settles by hand, so it controls which request answers first. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

const tokenNamed = (symbol: string) => ({
  address: `0x${symbol}`,
  name: symbol,
  symbol,
  decimals: 18,
})

/*
 * The full Ethereum list takes up to a second to download and a third of a
 * second to render. These pin the order the rows arrive in: the slice first,
 * then the whole list in its place.
 */
describe('useChainTokens first screen', () => {
  const SLICE = compactBody(1, [tokenNamed('AAA')], { total: 3 })
  const FULL = compactBody(1, [tokenNamed('AAA'), tokenNamed('BBB'), tokenNamed('CCC')])

  function serve({ slice, full }: { slice: Promise<unknown>; full: Promise<unknown> }) {
    mockFetch.mockImplementation((url: string) => {
      const answer = url.includes(`limit=${FIRST_SCREEN_TOKEN_COUNT}`) ? slice : full
      return answer.then(jsonResponse)
    })
  }

  it('asks for the slice and the full list in parallel', async () => {
    respondWith(FULL)
    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(3))

    expect(mockFetch).toHaveBeenCalledWith(`https://api.test/list/tokens/eip155-1?${COMPACT_TOKEN_QUERY}`)
    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.test/list/tokens/eip155-1?limit=${FIRST_SCREEN_TOKEN_COUNT}&${COMPACT_TOKEN_QUERY}`,
    )
  })

  it('shows the slice, with the full total, before the full list arrives', async () => {
    const full = deferred<unknown>()
    serve({ slice: Promise.resolve(SLICE), full: full.promise })
    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.tokens).toHaveLength(1))
    // The slice carries the server's total, not its own length.
    expect(result.current.total).toBe(3)
    expect(result.current.isLoading).toBe(false)
  })

  it('replaces the slice with the full list once it arrives', async () => {
    const full = deferred<unknown>()
    serve({ slice: Promise.resolve(SLICE), full: full.promise })
    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))

    full.resolve(FULL)
    await waitFor(() => expect(result.current.tokens.map((token) => token.symbol)).toEqual(['AAA', 'BBB', 'CCC']))
  })

  it('keeps the full list when the slice answers after it', async () => {
    const slice = deferred<unknown>()
    serve({ slice: slice.promise, full: Promise.resolve(FULL) })
    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(3))

    slice.resolve(SLICE)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(result.current.tokens).toHaveLength(3)
  })

  it('stays loading until one of the two requests has answered', async () => {
    const slice = deferred<unknown>()
    const full = deferred<unknown>()
    serve({ slice: slice.promise, full: full.promise })
    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper: createWrapper() })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.tokens).toEqual([])
    expect(result.current.total).toBeNull()

    slice.resolve(SLICE)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  // Icons are the slowest part of a cold click, and they cannot start until the
  // slice names them. They start on the slice, not after the full list.
  it('starts the slice icons as soon as the slice arrives, once per chain', async () => {
    const requested: string[] = []
    vi.stubGlobal(
      'Image',
      class {
        set src(url: string) {
          requested.push(url)
        }
      },
    )
    const slice = deferred<unknown>()
    serve({ slice: slice.promise, full: new Promise(() => {}) })
    const wrapper = createWrapper()
    const { result, rerender } = renderHook(() => useChainTokens('eip155-42'), { wrapper })
    expect(requested).toEqual([])

    slice.resolve(compactBody(42, [tokenNamed('AAA'), tokenNamed('BBB')]))
    await waitFor(() => expect(result.current.tokens).toHaveLength(2))
    rerender()

    expect(requested).toHaveLength(2)
    expect(requested[0]).toContain('/image/eip155-42/0xAAA?')
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', mockFetch)
  })

  it('shows the slice when the full list fails', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('limit=') ? jsonResponse(SLICE) : { ok: false, status: 500, json: () => Promise.resolve({}) },
      ),
    )
    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))
  })
})

/*
 * `shapeTokens` must give the Studio the same `Token`s it got from the default
 * body, so the browser, the `?token=` lookup and the icon preload need no change.
 */
describe('shapeTokens', () => {
  /** What `shapeTokens` returned for a default-format token before the compact body. */
  const fromDefaultBody = (
    token: { address: string; name: string; symbol: string; decimals: number; sources?: string[] },
    chainId: number,
    identifier: string,
  ) => {
    const sources = token.sources ?? []
    const listReferences = sources.map((sourceList) => ({
      sourceList,
      imageUri: `https://api.test/image/${identifier}/${token.address}`,
      imageFormat: '',
    }))
    return {
      chainId,
      chainIdentifier: identifier,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      hasIcon: true,
      sourceList: sources[0] ?? 'merged',
      listReferences: listReferences.length > 0 ? listReferences : undefined,
    }
  }

  it('produces the Tokens the default body produced', () => {
    const tokens = [
      { address: '0xa', name: 'Alpha', symbol: 'AAA', decimals: 18, sources: ['p/one', 'p/two'] },
      { address: '0xb', name: 'Beta', symbol: 'BBB', decimals: 6 },
    ]
    expect(shapeTokens(compactBody(10, tokens), 'eip155-10')).toEqual(
      tokens.map((token) => fromDefaultBody(token, 10, 'eip155-10')),
    )
  })
})
