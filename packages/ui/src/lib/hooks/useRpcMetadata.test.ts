import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

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
})

describe('useRpcMetadata hook', () => {
  beforeEach(() => {
    localStorage.clear()
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

    // Chain 999999 has no known RPC in viem/chains and none in localStorage
    const tokens = [{ address: '0xabc', chainId: 999999, name: '', symbol: '', decimals: 18, order: 0 }]
    const results = await result.current.loadMetadata(tokens, 999999)

    expect(results).toHaveLength(1)
    expect(results[0].address).toBe('0xabc')
    expect(results[0].name).toBeNull()
    expect(results[0].symbol).toBeNull()
    expect(results[0].decimals).toBeNull()
    expect(results[0].error).toBe('No RPC available')
  })
})
