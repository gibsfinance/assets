import { describe, it, expect, vi, beforeEach } from 'vitest'

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
