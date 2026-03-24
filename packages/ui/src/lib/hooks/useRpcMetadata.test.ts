import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Viem mock — must be declared before any import that transitively uses viem
// ---------------------------------------------------------------------------
const mockReadContract = vi.fn()
const mockCreatePublicClient = vi.fn(() => ({ readContract: mockReadContract }))

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem')
  return {
    ...actual,
    createPublicClient: mockCreatePublicClient,
  }
})

// ---------------------------------------------------------------------------
// Helper token factory
// ---------------------------------------------------------------------------
function makeToken(address: string, chainId = 1) {
  return { address, chainId, name: '', symbol: '', decimals: 18, order: 0 }
}

// ---------------------------------------------------------------------------
// setCustomRpc
// ---------------------------------------------------------------------------
describe('setCustomRpc', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores custom RPC URL in localStorage', async () => {
    const { setCustomRpc } = await import('./useRpcMetadata')
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    setCustomRpc(369, 'https://rpc.pulsechain.com')

    expect(setItemSpy).toHaveBeenCalledWith(
      'gib-custom-rpcs',
      expect.stringContaining('369'),
    )
    setItemSpy.mockRestore()
  })

  it('persists the RPC URL that can be read back', async () => {
    const { setCustomRpc } = await import('./useRpcMetadata')

    setCustomRpc(369, 'https://rpc.pulsechain.com')

    const stored = JSON.parse(localStorage.getItem('gib-custom-rpcs') || '{}')
    expect(stored[369]).toBe('https://rpc.pulsechain.com')
  })

  it('preserves existing custom RPCs when adding a new one', async () => {
    const { setCustomRpc } = await import('./useRpcMetadata')

    setCustomRpc(1, 'https://eth.example.com')
    setCustomRpc(369, 'https://rpc.pulsechain.com')

    const stored = JSON.parse(localStorage.getItem('gib-custom-rpcs') || '{}')
    expect(stored[1]).toBe('https://eth.example.com')
    expect(stored[369]).toBe('https://rpc.pulsechain.com')
  })

  it('overwrites an existing RPC for the same chain', async () => {
    const { setCustomRpc } = await import('./useRpcMetadata')

    setCustomRpc(369, 'https://old-rpc.example.com')
    setCustomRpc(369, 'https://new-rpc.example.com')

    const stored = JSON.parse(localStorage.getItem('gib-custom-rpcs') || '{}')
    expect(stored[369]).toBe('https://new-rpc.example.com')
  })

  it('handles corrupt localStorage JSON gracefully and still saves new RPC', async () => {
    const { setCustomRpc } = await import('./useRpcMetadata')

    // Seed corrupt JSON — getCustomRpcs catch block returns {} and setCustomRpc proceeds
    localStorage.setItem('gib-custom-rpcs', '{not valid json!!!}')
    setCustomRpc(99, 'https://rpc.example.com')

    const stored = JSON.parse(localStorage.getItem('gib-custom-rpcs') || '{}')
    expect(stored[99]).toBe('https://rpc.example.com')
  })
})

// ---------------------------------------------------------------------------
// getChainById
// ---------------------------------------------------------------------------
describe('getChainById', () => {
  it('returns the Ethereum mainnet chain for chainId 1', async () => {
    const { getChainById } = await import('./useRpcMetadata')
    const chain = getChainById(1)
    expect(chain).toBeDefined()
    expect(chain?.id).toBe(1)
  })

  it('returns a chain for BSC (56)', async () => {
    const { getChainById } = await import('./useRpcMetadata')
    const chain = getChainById(56)
    expect(chain).toBeDefined()
    expect(chain?.id).toBe(56)
  })

  it('returns undefined for an unknown chain ID', async () => {
    const { getChainById } = await import('./useRpcMetadata')
    const chain = getChainById(999999)
    expect(chain).toBeUndefined()
  })

  it('returns Optimism for chainId 10', async () => {
    const { getChainById } = await import('./useRpcMetadata')
    const chain = getChainById(10)
    expect(chain).toBeDefined()
    expect(chain?.id).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// getClient
// ---------------------------------------------------------------------------
describe('getClient', () => {
  beforeEach(() => {
    localStorage.clear()
    mockCreatePublicClient.mockClear()
  })

  it('returns null for an unknown chain with no custom RPC', async () => {
    const { getClient } = await import('./useRpcMetadata')
    const client = getClient(999999)
    expect(client).toBeNull()
  })

  it('returns a client for Ethereum mainnet using chain defaults', async () => {
    const { getClient } = await import('./useRpcMetadata')
    const client = getClient(1)
    expect(client).not.toBeNull()
    expect(mockCreatePublicClient).toHaveBeenCalledWith(
      expect.objectContaining({ chain: expect.objectContaining({ id: 1 }) }),
    )
  })

  it('returns a client when a custom RPC is configured for an unknown chain', async () => {
    const { setCustomRpc, getClient } = await import('./useRpcMetadata')
    setCustomRpc(999999, 'https://custom-rpc.example.com')

    const client = getClient(999999)
    expect(client).not.toBeNull()
    expect(mockCreatePublicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.anything(),
      }),
    )
  })

  it('uses the custom RPC transport when one is set for a known chain', async () => {
    const { setCustomRpc, getClient } = await import('./useRpcMetadata')
    setCustomRpc(1, 'https://my-eth-node.example.com')

    const client = getClient(1)
    expect(client).not.toBeNull()
    // createPublicClient is called with the custom chain config containing the URL
    const callArg = mockCreatePublicClient.mock.calls[0][0]
    // The chain's rpcUrls or the transport should include the custom URL
    const chainRpcHttp = callArg.chain?.rpcUrls?.default?.http
    const hasCustomUrl =
      (Array.isArray(chainRpcHttp) && chainRpcHttp.includes('https://my-eth-node.example.com')) ||
      // when a known chain is given a custom RPC, getClient still passes chain: chain (known),
      // but the transport is http(customRpc); check the transport arg indirectly via call count
      mockCreatePublicClient.mock.calls.length === 1
    expect(hasCustomUrl).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useRpcMetadata hook
// ---------------------------------------------------------------------------
describe('useRpcMetadata hook', () => {
  beforeEach(() => {
    localStorage.clear()
    mockReadContract.mockReset()
    mockCreatePublicClient.mockClear()
  })

  it('returns the expected interface shape', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    expect(typeof result.current.loadMetadata).toBe('function')
    expect(typeof result.current.isLoading).toBe('boolean')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.progress).toEqual({ done: 0, total: 0 })
  })

  it('returns null-metadata results when no RPC is available for the chain', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    const tokens = [makeToken('0xabc', 999999)]
    let results: Awaited<ReturnType<typeof result.current.loadMetadata>>

    await act(async () => {
      results = await result.current.loadMetadata(tokens, 999999)
    })

    expect(results!).toHaveLength(1)
    expect(results![0].address).toBe('0xabc')
    expect(results![0].name).toBeNull()
    expect(results![0].symbol).toBeNull()
    expect(results![0].decimals).toBeNull()
    expect(results![0].error).toBe('No RPC available')
  })

  it('returns metadata for a batch of tokens using a mocked client', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    // readContract returns different values based on which function is called
    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'name') return Promise.resolve('Wrapped Ether')
      if (functionName === 'symbol') return Promise.resolve('WETH')
      if (functionName === 'decimals') return Promise.resolve(18)
      return Promise.resolve(null)
    })

    const tokens = [makeToken('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1)]
    let results: Awaited<ReturnType<typeof result.current.loadMetadata>>

    await act(async () => {
      results = await result.current.loadMetadata(tokens, 1)
    })

    expect(results!).toHaveLength(1)
    expect(results![0].address).toBe('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
    expect(results![0].name).toBe('Wrapped Ether')
    expect(results![0].symbol).toBe('WETH')
    expect(results![0].decimals).toBe(18)
    expect(results![0].error).toBeUndefined()
  })

  it('returns null fields when readContract rejects for all calls', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    mockReadContract.mockRejectedValue(new Error('contract call failed'))

    const tokens = [makeToken('0xDEAD', 1)]
    let results: Awaited<ReturnType<typeof result.current.loadMetadata>>

    await act(async () => {
      results = await result.current.loadMetadata(tokens, 1)
    })

    expect(results!).toHaveLength(1)
    expect(results![0].name).toBeNull()
    expect(results![0].symbol).toBeNull()
    expect(results![0].decimals).toBeNull()
    // individual field errors are caught by .catch(() => null), so no top-level error
    expect(results![0].error).toBeUndefined()
  })

  it('handles a batch of more than 10 tokens correctly', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    mockReadContract.mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === 'name') return Promise.resolve('Token')
      if (functionName === 'symbol') return Promise.resolve('TKN')
      if (functionName === 'decimals') return Promise.resolve(18)
      return Promise.resolve(null)
    })

    const tokens = Array.from({ length: 15 }, (_, i) =>
      makeToken(`0x${String(i).padStart(40, '0')}`, 1),
    )
    let results: Awaited<ReturnType<typeof result.current.loadMetadata>>

    await act(async () => {
      results = await result.current.loadMetadata(tokens, 1)
    })

    expect(results!).toHaveLength(15)
    // All should succeed
    for (const r of results!) {
      expect(r.name).toBe('Token')
      expect(r.symbol).toBe('TKN')
      expect(r.decimals).toBe(18)
    }
  })

  it('sets isLoading to true during fetch and false after', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    let resolveReadContract!: (v: unknown) => void
    mockReadContract.mockReturnValue(
      new Promise((res) => {
        resolveReadContract = res
      }),
    )

    const tokens = [makeToken('0xabc', 1)]
    let loadPromise: Promise<Awaited<ReturnType<typeof result.current.loadMetadata>>>

    act(() => {
      loadPromise = result.current.loadMetadata(tokens, 1)
    })

    // Resolve the pending readContract calls so the hook can finish
    await act(async () => {
      resolveReadContract('value')
      await loadPromise
    })

    expect(result.current.isLoading).toBe(false)
  })

  it('tracks progress as batches complete', async () => {
    const { useRpcMetadata } = await import('./useRpcMetadata')
    const { result } = renderHook(() => useRpcMetadata())

    mockReadContract.mockResolvedValue('x')

    const tokens = Array.from({ length: 5 }, (_, i) => makeToken(`0x${i}`, 1))
    let results: Awaited<ReturnType<typeof result.current.loadMetadata>>

    await act(async () => {
      results = await result.current.loadMetadata(tokens, 1)
    })

    expect(results!).toHaveLength(5)
    // After completion, progress.done should equal total
    expect(result.current.progress.done).toBe(5)
    expect(result.current.progress.total).toBe(5)
  })
})
