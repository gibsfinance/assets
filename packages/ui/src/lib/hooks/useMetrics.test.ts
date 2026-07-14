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
      { chainId: '1', chainIdentifier: 'eip155-1', count: 5000 },
      { chainId: '369', chainIdentifier: 'eip155-369', count: 2000 },
    ]
    const networks = [
      { type: 'evm', chainId: '1', networkId: '1', chainIdentifier: 'eip155-1', imageHash: 'abc' },
      { type: 'evm', chainId: '369', networkId: '369', chainIdentifier: 'eip155-369', imageHash: null },
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
    const ethereum = metrics!.networks.supported.find((n) => n.chainIdentifier === 'eip155-1')!
    expect(ethereum.type).toBe('evm')
    expect(ethereum.isEvm).toBe(true)
    expect(ethereum.hasImage).toBe(true)
    expect(ethereum.tokenCount).toBe(5000)
    expect(ethereum.name).toBe('Ethereum')
    const pulsechain = metrics!.networks.supported.find((n) => n.chainIdentifier === 'eip155-369')!
    expect(pulsechain.hasImage).toBe(false)
    expect(pulsechain.tokenCount).toBe(2000)
    expect(result.current.providers).toHaveLength(1)
  })

  it('keeps non-Ethereum-Virtual-Machine networks with a zero token count', async () => {
    const stats = [
      { chainId: '1', chainIdentifier: 'eip155-1', count: 5000 },
      // Ethereum-Virtual-Machine chain 128 (Huobi) — proves no bare-reference collision with monero-128
      { chainId: '128', chainIdentifier: 'eip155-128', count: 42 },
    ]
    const networks = [
      { type: 'evm', chainId: '1', networkId: '1', chainIdentifier: 'eip155-1', imageHash: 'abc' },
      { type: 'evm', chainId: '128', networkId: '128', chainIdentifier: 'eip155-128', imageHash: 'huobi' },
      { type: 'bip122', chainId: '0', networkId: 'nid-btc', chainIdentifier: 'bip122-0', imageHash: 'abc' },
      { type: 'monero', chainId: '128', networkId: 'nid-xmr', chainIdentifier: 'monero-128', imageHash: 'def' },
    ]
    const providers: unknown[] = []

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
    const btc = metrics!.networks.supported.find((n) => n.chainIdentifier === 'bip122-0')!
    expect(btc.type).toBe('bip122')
    expect(btc.isEvm).toBe(false)
    expect(btc.tokenCount).toBe(0)
    expect(btc.name).toBe('Bitcoin')
    const xmr = metrics!.networks.supported.find((n) => n.chainIdentifier === 'monero-128')!
    expect(xmr.tokenCount).toBe(0) // NOT 42 — must key on chainIdentifier, not bare '128'
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
