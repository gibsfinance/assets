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

import { useChainTokens } from './useChainTokens'

/** One QueryClient per render so tests never share cache — except where asserted. */
function createWrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
}

const respondWith = (body: unknown) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) })

const SOLANA_RESPONSE = {
  chainId: 501,
  total: 9633,
  tokens: [
    {
      chainId: 501,
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      logoURI: 'https://logo/usdc.png',
      sources: ['jupiter/tag-strict', 'coingecko/solana-501'],
    },
  ],
}

beforeEach(() => mockFetch.mockReset())

describe('useChainTokens', () => {
  it('requests the chain by its namespaced identifier', async () => {
    respondWith(SOLANA_RESPONSE)
    const { result } = renderHook(() => useChainTokens('solana-501'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.tokens).toHaveLength(1))
    expect(mockFetch).toHaveBeenCalledWith('https://api.test/list/tokens/solana-501')
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

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith('https://api.test/list/tokens/eip155-369')
  })

  it('fetches nothing and reports empty while no chain is chosen', async () => {
    respondWith(SOLANA_RESPONSE)
    const { result } = renderHook(() => useChainTokens(null), { wrapper: createWrapper() })
    expect(result.current.tokens).toEqual([])
    expect(result.current.total).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
