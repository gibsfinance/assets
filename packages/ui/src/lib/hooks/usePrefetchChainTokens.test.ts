import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { compactBody } from '../../../tests/compact-body'
import { COMPACT_TOKEN_QUERY } from '../utils/compact-tokens'
import { usePrefetchChainTokens, ICON_DWELL_MILLISECONDS } from './usePrefetchChainTokens'

const RESPONSE = compactBody(1, [{ address: '0xA', name: 'A', symbol: 'AAA', decimals: 18 }])

const FULL_URL = `https://api.test/list/tokens/eip155-1?${COMPACT_TOKEN_QUERY}`
const SLICE_URL = `https://api.test/list/tokens/eip155-1?limit=${FIRST_SCREEN_TOKEN_COUNT}&${COMPACT_TOKEN_QUERY}`

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
  // Hover and focus fire for every control the pointer crosses, including all
  // 1,900+ rows of the network drawer. Fetching full lists there would start a
  // multi-megabyte download per chain passed over, so they fetch only the slice.
  it.each(['onPointerEnter', 'onFocus'] as const)('requests only the first screen on %s', async (eventName) => {
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    result.current('eip155-1')[eventName]()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(SLICE_URL))
    await waitFor(() => expect(client.getQueryData(['tokensByChainFirstScreen', 'eip155-1'])).toBeDefined())
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).not.toHaveBeenCalledWith(FULL_URL)
  })

  it('requests the slice and the full list on onPointerDown', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    result.current('eip155-1').onPointerDown()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    expect(mockFetch).toHaveBeenCalledWith(FULL_URL)
    expect(mockFetch).toHaveBeenCalledWith(SLICE_URL)
  })

  it('downloads no full list while the pointer sweeps across many chains', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    for (const chainId of [1, 10, 56, 137, 369, 8453]) result.current(chainId).onPointerEnter()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(6))
    for (const [url] of mockFetch.mock.calls) expect(url).toContain(`?limit=${FIRST_SCREEN_TOKEN_COUNT}`)
  })

  it('names a bare chain id by its namespaced identifier', async () => {
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    result.current(1).onPointerDown()

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(FULL_URL))
  })

  // The point of the prefetch: the click renders from the cache instead of
  // starting a download. If the keys differed, the hook would fetch again.
  it('fills the cache entries that useChainTokens reads, so the click makes no request', async () => {
    const client = createClient()
    const wrapper = wrapperFor(client)
    const prefetch = renderHook(() => usePrefetchChainTokens(), { wrapper })
    prefetch.result.current('eip155-1').onPointerDown()
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
    result.current('eip155-1').onPointerDown()
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

    result.current('eip155-1').onPointerDown()
    result.current('eip155-1').onPointerEnter()
    result.current('eip155-1').onPointerDown()

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('swallows a failed prefetch so the hover raises no error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const client = createClient()
    const { result } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(client) })

    expect(() => result.current('eip155-1').onPointerDown()).not.toThrow()
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

describe('usePrefetchChainTokens icon preloading', () => {
  const ICON_RESPONSE = compactBody(10, [{ address: '0xA', name: 'A', symbol: 'AAA', decimals: 18 }])
  let requested: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    requested = []
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(ICON_RESPONSE) })
    vi.stubGlobal(
      'Image',
      class {
        set src(url: string) {
          requested.push(url)
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', mockFetch)
  })

  const setup = (chainId: string) => {
    const { result, unmount } = renderHook(() => usePrefetchChainTokens(), { wrapper: wrapperFor(createClient()) })
    return { handlers: result.current(chainId), unmount }
  }

  // A pointer crossing the 1,900-row drawer must not start icon requests per row.
  it('starts no icon requests when the pointer crosses a control in less than the dwell', async () => {
    const { handlers } = setup('eip155-10')

    handlers.onPointerEnter()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS - 1)
    handlers.onPointerLeave()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS * 2)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(requested).toEqual([])
  })

  it('starts the icon requests once the pointer has rested for the dwell', async () => {
    const { handlers } = setup('eip155-11')

    handlers.onPointerEnter()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS)

    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain('/image/eip155-11/0xA?')
  })

  it('cancels the wait on blur', async () => {
    const { handlers } = setup('eip155-12')

    handlers.onFocus()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS - 1)
    handlers.onBlur()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS * 2)

    expect(requested).toEqual([])
  })

  it('restarts the wait when the pointer moves to another control', async () => {
    const { handlers } = setup('eip155-13')

    handlers.onPointerEnter()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS - 1)
    handlers.onPointerEnter()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS - 1)

    expect(requested).toEqual([])
  })

  it('starts the icon requests at once on pointerdown', async () => {
    const { handlers } = setup('eip155-14')

    handlers.onPointerDown()
    await vi.advanceTimersByTimeAsync(0)

    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain('/image/eip155-14/0xA?')
  })

  it('drops a pending wait when pointerdown arrives, so the icons start only once', async () => {
    const { handlers } = setup('eip155-15')

    handlers.onPointerEnter()
    handlers.onPointerDown()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS * 2)

    expect(requested).toHaveLength(1)
  })

  it('drops a pending wait when the component unmounts', async () => {
    const { handlers, unmount } = setup('eip155-16')

    handlers.onPointerEnter()
    unmount()
    await vi.advanceTimersByTimeAsync(ICON_DWELL_MILLISECONDS * 2)

    expect(requested).toEqual([])
  })

  it('starts no icons when the slice request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    const { handlers } = setup('eip155-17')

    handlers.onPointerDown()
    await vi.advanceTimersByTimeAsync(0)

    expect(requested).toEqual([])
  })
})
