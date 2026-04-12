import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Global fetch mock
// ---------------------------------------------------------------------------
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Wrapper factory — fresh QueryClient per test
// ---------------------------------------------------------------------------
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useStats', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.resetModules()
  })

  it('returns stats data from /stats endpoint', async () => {
    const statsPayload = [
      { chainId: '1', count: 5000 },
      { chainId: '369', count: 2000 },
    ]

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(statsPayload),
    })

    const { useStats } = await import('./useMetrics')
    const { result } = renderHook(() => useStats(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data).toEqual(statsPayload)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/stats'),
    )
  })

  it('returns empty array when /stats responds with an error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    })

    const { useStats } = await import('./useMetrics')
    const { result } = renderHook(() => useStats(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data).toEqual([])
  })
})

describe('useProviders', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.resetModules()
  })

  it('returns provider list from /list endpoint', async () => {
    const providers = [
      { key: 'tokens', name: 'CoinGecko', providerKey: 'coingecko', chainId: '0', chainType: 'evm', default: true, description: '' },
    ]

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(providers),
    })

    const { useProviders } = await import('./useMetrics')
    const { result } = renderHook(() => useProviders(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data).toBeDefined())

    expect(result.current.data).toEqual(providers)
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/list'))
  })
})

describe('useMetrics (composite)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.resetModules()
  })

  it('derives PlatformMetrics from stats and networks', async () => {
    const stats = [
      { chainId: '1', count: 5000 },
      { chainId: '369', count: 2000 },
    ]
    const networks = [
      { type: 'evm', chainId: '1', networkId: '1' },
      { type: 'evm', chainId: '369', networkId: '369' },
    ]
    const providers = [
      { key: 'tokens', name: 'CoinGecko', providerKey: 'coingecko', chainId: '0', chainType: 'evm', default: true, description: '' },
    ]

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/stats')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stats) })
      }
      if (url.includes('/networks')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(networks) })
      }
      if (url.includes('/list')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(providers) })
      }
      return Promise.resolve({ ok: false })
    })

    const { useMetrics } = await import('./useMetrics')
    const { result } = renderHook(() => useMetrics(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.metrics).not.toBeNull())

    const { metrics } = result.current
    expect(metrics!.tokenList.total).toBe(7000)
    expect(metrics!.tokenList.byChain[1]).toBe(5000)
    expect(metrics!.tokenList.byChain[369]).toBe(2000)
    expect(metrics!.networks.supported).toHaveLength(2)
    expect(metrics!.networks.active).toBe('PulseChain')
    expect(result.current.providers).toHaveLength(1)
  })

  it('returns null metrics while loading', async () => {
    // Never resolve fetches so we stay in loading state
    mockFetch.mockReturnValue(new Promise(() => {}))

    const { useMetrics } = await import('./useMetrics')
    const { result } = renderHook(() => useMetrics(), {
      wrapper: createWrapper(),
    })

    expect(result.current.metrics).toBeNull()
    expect(result.current.isLoading).toBe(true)
  })
})
