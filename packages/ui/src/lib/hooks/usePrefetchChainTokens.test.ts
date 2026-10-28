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

import { useChainTokens, FIRST_SCREEN_TOKEN_COUNT } from './useChainTokens'
import { usePrefetchChainTokens } from './usePrefetchChainTokens'

const RESPONSE = {
  chainId: 1,
  total: 1,
  tokens: [{ chainId: 1, address: '0xA', name: 'A', symbol: 'AAA', decimals: 18 }],
}

const FULL_URL = 'https://api.test/list/tokens/eip155-1'
const SLICE_URL = `https://api.test/list/tokens/eip155-1?limit=${FIRST_SCREEN_TOKEN_COUNT}`

/** A client that keeps data between renders, as the application's does. */
function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children)
  }

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(RESPONSE) })
})

describe('usePrefetchChainTokens', () => {
  it.each(['onPointerEnter', 'onFocus', 'onPointerDown'] as const)(
    'requests the slice and the full list on %s',
    async (eventName) => {
      const client = createClient()
      const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

      result.current('eip155-1')[eventName]()

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
      expect(mockFetch).toHaveBeenCalledWith(FULL_URL)
      expect(mockFetch).toHaveBeenCalledWith(SLICE_URL)
    },
  )

  it('names a bare chain id by its namespaced identifier', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    result.current(1).onPointerEnter()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(FULL_URL))
  })

  // The point of the prefetch: the click renders from the cache instead of
  // starting a download. If the keys differed, the hook would fetch again.
  it('fills the cache entries that useChainTokens reads, so the click makes no request', async () => {
    const client = createClient()
    const wrapper = wrapperFor(client)
    const prefetch = renderHook(() => usePrefetchChainTokens(), { wrapper })
    prefetch.result.current('eip155-1').onPointerEnter()
    await waitFor(() => expect(client.getQueryData(['tokensByChain', 'eip155-1'])).toBeDefined())
    await waitFor(() => expect(client.getQueryData(['tokensByChainFirstScreen', 'eip155-1'])).toBeDefined())
    mockFetch.mockClear()

    const { result } = renderHook(() => useChainTokens('eip155-1'), { wrapper })

    expect(result.current.tokens).toHaveLength(1)
    expect(result.current.isLoading).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not refetch on a second hover', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })
    result.current('eip155-1').onPointerEnter()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(client.getQueryData(['tokensByChain', 'eip155-1'])).toBeDefined())

    result.current('eip155-1').onPointerEnter()
    result.current('eip155-1').onFocus()
    result.current('eip155-1').onPointerDown()

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('shares one request among hovers that land while the first is in flight', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    result.current('eip155-1').onPointerEnter()
    result.current('eip155-1').onFocus()
    result.current('eip155-1').onPointerDown()

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('swallows a failed prefetch so the hover raises no error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    expect(() => result.current('eip155-1').onPointerEnter()).not.toThrow()
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  })

  it('returns a stable function while the client is unchanged', () => {
    const client = createClient()
    const { result, rerender } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
