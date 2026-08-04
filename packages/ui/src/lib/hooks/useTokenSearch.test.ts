/**
 * The cross-chain token search.
 *
 * Everything worth guarding here is invisible when it breaks. A term below the
 * endpoint's minimum still looks like a search to the user; a superseded request
 * that publishes its own empty result looks like the token vanishing; a spinner
 * lowered by the wrong search looks like a finished search that returned nothing.
 * None of it raises an error, so each has to be asserted directly.
 *
 * The fetch stand-in honours the abort signal the way the real one does — a mock
 * that ignores it would let every superseded request resolve, and the tests that
 * matter most would pass against a hook that never aborted anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return { ...actual, getApiUrl: (path: string) => `https://api.test${path}` }
})

import { useTokenSearch, MINIMUM_SEARCH_LENGTH, SEARCH_DEBOUNCE_MILLISECONDS } from './useTokenSearch'
import type { SearchUpdate } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Base58 address on a chain whose number is also claimed by an eip155 testnet. */
const SOLANA_USDC = {
  chainId: 501,
  chainIdentifier: 'solana-501',
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  logoURI: 'https://logo/usdc.png',
  sources: ['jupiter/tag-strict', 'coingecko/solana-501'],
}

const PULSECHAIN_USDC = {
  chainId: 369,
  chainIdentifier: 'eip155-369',
  address: '0x0000000000000000000000000000000000000369',
  name: 'USD Coin from Ethereum',
  symbol: 'USDC',
  decimals: 6,
  logoURI: 'https://logo/usdc.png',
  sources: ['pulsechain/bridge'],
}

/** Neither an icon nor a source list — every optional field absent. */
const BARE_TOKEN = {
  chainId: 1,
  address: '0x0000000000000000000000000000000000000001',
  name: 'Bare Token',
  symbol: 'BARE',
  decimals: 18,
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const jsonBody = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

/**
 * A fetch that resolves after `delay` and rejects the moment it is aborted,
 * matching the contract the hook relies on to supersede a running search.
 */
const respondAfter = (body: unknown, delay = 0) =>
  vi.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(jsonBody(body)), delay)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      }),
  )

function renderSearch() {
  const updates: SearchUpdate[] = []
  // A fresh callback on every render, which is what the hook's ref indirection
  // has to absorb: if this identity reached the debounced wrapper, the wrapper
  // would be rebuilt mid-typing and lose its pending invocation.
  const view = renderHook(() =>
    useTokenSearch({
      onUpdate: (update) => {
        updates.push(update)
      },
    }),
  )
  const search = (raw: string) => act(() => view.result.current.search(raw))
  return { ...view, updates, search }
}

/** Push past the debounce window and let the request settle. */
const settle = async (milliseconds = SEARCH_DEBOUNCE_MILLISECONDS) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** The query strings the hook asked the server for, in order. */
const requestedQueries = () => mockFetch.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('q'))

beforeEach(() => {
  vi.useFakeTimers()
  mockFetch.mockReset()
  mockFetch.mockImplementation(() => Promise.resolve(jsonBody({ query: '', truncated: false, tokens: [] })))
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('useTokenSearch — what reaches the server', () => {
  it('issues one request to the search endpoint rather than a list-per-provider fan-out', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonBody({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC] })),
    )
    const { search } = renderSearch()

    search('usdc')
    await settle()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://api.test/list/search?q=usdc')
  })

  it('never asks for a term the endpoint would reject as too short', async () => {
    // Below the minimum the server answers 400. Firing anyway spends a round trip to be
    // told so, and the rejection is indistinguishable downstream from a search that failed.
    const { search, updates } = renderSearch()

    search('u'.repeat(MINIMUM_SEARCH_LENGTH - 1))
    await settle(SEARCH_DEBOUNCE_MILLISECONDS * 4)

    expect(mockFetch).not.toHaveBeenCalled()
    // The keystroke still has to be reported, or the local filter never narrows.
    expect(updates.at(-1)).toMatchObject({ query: 'u', tokens: [], isSearching: false })
  })

  it('searches once typing pauses rather than once per keystroke', async () => {
    const { search } = renderSearch()

    search('us')
    await settle(SEARCH_DEBOUNCE_MILLISECONDS - 1)
    expect(mockFetch).not.toHaveBeenCalled()

    search('usd')
    await settle(SEARCH_DEBOUNCE_MILLISECONDS - 1)
    expect(mockFetch).not.toHaveBeenCalled()

    search('usdc')
    await settle()
    expect(requestedQueries()).toEqual(['usdc'])
  })

  it('sends the term trimmed while reporting it exactly as typed', async () => {
    // The two differ on purpose: the server rejects nothing for surrounding spaces, but
    // the local filter matches against what is in the box, character for character.
    const { search, updates } = renderSearch()

    search('  usdc  ')
    await settle()

    expect(requestedQueries()).toEqual(['usdc'])
    expect(updates[0].query).toBe('  usdc  ')
  })

  it('encodes a term that would otherwise change the query string', async () => {
    const { search } = renderSearch()

    search('a&b=c')
    await settle()

    expect(String(mockFetch.mock.calls[0][0])).toBe('https://api.test/list/search?q=a%26b%3Dc')
  })

  it('does not scope the search to any one chain', async () => {
    // Scoping it would make it a slower copy of the local filter. The reason to issue it
    // at all is to find tokens the chain on screen has never heard of.
    const { search } = renderSearch()

    search('usdc')
    await settle()

    expect(String(mockFetch.mock.calls[0][0])).not.toContain('chainId')
  })
})

describe('useTokenSearch — shaping the results', () => {
  it('keeps every hit on the namespace the server listed it under', async () => {
    // Results span chains, so the chain being browsed says nothing about where a hit
    // lives, and a bare number names no namespace — 501 is Solana's and Columbus
    // testnet's alike. Rebuilding an identifier from it asked for a base58 address
    // under eip155-501 and got a 400 for every Solana icon.
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonBody({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC, PULSECHAIN_USDC] })),
    )
    const { search, updates } = renderSearch()

    search('usdc')
    await settle()

    const tokens = updates.at(-1)!.tokens
    expect(tokens.map((token) => token.chainIdentifier)).toEqual(['solana-501', 'eip155-369'])
    expect(tokens[0].listReferences?.[0].imageUri).toBe(
      'https://api.test/image/solana-501/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    )
  })

  it('falls back to the bare number only when the response carries no namespace', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonBody({ query: 'bare', truncated: false, tokens: [BARE_TOKEN] })),
    )
    const { search, updates } = renderSearch()

    search('bare')
    await settle()

    expect(updates.at(-1)!.tokens[0].chainIdentifier).toBe('eip155-1')
  })

  it('derives the icon flag and source lists the same way the chain list does', async () => {
    // Two call sites building a Token from a server response are two chances to
    // disagree about whether a token has an icon or which list it came from.
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonBody({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC, BARE_TOKEN] })),
    )
    const { search, updates } = renderSearch()

    search('usdc')
    await settle()

    const [withIcon, without] = updates.at(-1)!.tokens
    expect(withIcon).toMatchObject({ hasIcon: true, sourceList: 'jupiter/tag-strict' })
    expect(withIcon.listReferences).toHaveLength(2)
    expect(without).toMatchObject({ hasIcon: false, sourceList: 'merged' })
    expect(without.listReferences).toBeUndefined()
  })

  it('says when more matched than came back', async () => {
    // The query stops at a candidate cap, so there is no total to report. Without this
    // flag a list cut off at a round number reads as "your token is not listed".
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonBody({ query: 'usd', truncated: true, tokens: [SOLANA_USDC] })),
    )
    const { search, updates } = renderSearch()

    search('usd')
    await settle()

    expect(updates.at(-1)).toMatchObject({ truncated: true, isSearching: false, isError: false })
  })

  it('reports an untruncated response as complete', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonBody({ query: 'usd', tokens: [SOLANA_USDC] })))
    const { search, updates } = renderSearch()

    search('usd')
    await settle()

    expect(updates.at(-1)!.truncated).toBe(false)
  })

  it('survives a body that carries no token array', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonBody({ query: 'usd', truncated: false })))
    const { search, updates } = renderSearch()

    search('usd')
    await settle()

    expect(updates.at(-1)).toMatchObject({ tokens: [], isError: false, isSearching: false })
  })
})

describe('useTokenSearch — failures and supersession', () => {
  it('reports a rejected request as an error and stops searching', async () => {
    // The box is controlled and used to be gated on the in-flight flag, so a failure
    // that left the flag raised froze the input permanently: the user could neither
    // refine the query nor clear it.
    mockFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    const { search, updates, result } = renderSearch()

    search('usdc')
    await settle()

    expect(updates.at(-1)).toMatchObject({ query: 'usdc', isError: true, isSearching: false, tokens: [] })
    expect(result.current.isSearching).toBe(false)
  })

  it('reports a request that never reached the server as an error', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')))
    const { search, updates, result } = renderSearch()

    search('usdc')
    await settle()

    expect(updates.at(-1)).toMatchObject({ isError: true, isSearching: false })
    expect(result.current.isSearching).toBe(false)
  })

  it('lets a new search abandon the one in flight', async () => {
    mockFetch.mockImplementation(respondAfter({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC] }, 1000))
    const { search } = renderSearch()

    search('usdc')
    await settle()
    const firstSignal = (mockFetch.mock.calls[0][1] as { signal: AbortSignal }).signal
    expect(firstSignal.aborted).toBe(false)

    search('usdcoin')
    await settle()

    expect(firstSignal.aborted).toBe(true)
  })

  it('publishes nothing on behalf of a superseded search', async () => {
    // Its result set is empty and stale. Emitting it would wipe out what its successor
    // is in the middle of fetching, so matches appear and then vanish unprompted.
    mockFetch.mockImplementation(respondAfter({ query: 'usdcoin', truncated: false, tokens: [SOLANA_USDC] }, 1000))
    const { search, updates } = renderSearch()

    search('usdc')
    await settle()
    search('usdcoin')
    await settle()

    // Only the two keystroke echoes and the two in-flight notices, no failed tail.
    expect(updates.every((update) => !update.isError)).toBe(true)

    await settle(1000)
    expect(updates.at(-1)!.tokens).toHaveLength(1)
  })

  it('does not let a superseded search lower its successor’s spinner', async () => {
    // The regression this guards: the aborted predecessor cleared the flag, the spinner
    // read as finished while a request was still out, and the gated input stayed frozen.
    mockFetch.mockImplementation(respondAfter({ query: 'usdcoin', truncated: false, tokens: [SOLANA_USDC] }, 1000))
    const { search, result } = renderSearch()

    search('usdc')
    await settle()
    search('usdcoin')
    await settle()

    expect(result.current.isSearching).toBe(true)

    await settle(1000)
    expect(result.current.isSearching).toBe(false)
  })

  it('abandons the request in flight when the term drops below the minimum', async () => {
    // Clearing the box has to stick. Left running, the previous term's results land a
    // moment later and repopulate a list the user has just emptied.
    mockFetch.mockImplementation(respondAfter({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC] }, 1000))
    const { search, updates, result } = renderSearch()

    search('usdc')
    await settle()
    const signal = (mockFetch.mock.calls[0][1] as { signal: AbortSignal }).signal

    search('')
    await settle(2000)

    expect(signal.aborted).toBe(true)
    expect(result.current.isSearching).toBe(false)
    expect(updates.at(-1)).toMatchObject({ query: '', tokens: [], isSearching: false })
  })

  it('cancels a scheduled search when the box goes away', async () => {
    // Switching chains unmounts the box. A search that survived would resolve into a
    // caller that has moved on and overwrite the new chain's state.
    const { search, unmount } = renderSearch()

    search('usdc')
    await settle(SEARCH_DEBOUNCE_MILLISECONDS - 1)
    unmount()
    await settle(SEARCH_DEBOUNCE_MILLISECONDS * 4)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('abandons a request already in flight when the box goes away', async () => {
    mockFetch.mockImplementation(respondAfter({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC] }, 1000))
    const { search, unmount, updates } = renderSearch()

    search('usdc')
    await settle()
    const signal = (mockFetch.mock.calls[0][1] as { signal: AbortSignal }).signal

    unmount()
    const seen = updates.length
    await settle(2000)

    expect(signal.aborted).toBe(true)
    expect(updates).toHaveLength(seen)
  })

  it('keeps searching after one search has finished', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonBody({ query: 'usdc', truncated: false, tokens: [SOLANA_USDC] })),
    )
    const { search, result } = renderSearch()

    search('usdc')
    await settle()
    expect(result.current.isSearching).toBe(false)

    search('pls')
    await settle()

    expect(requestedQueries()).toEqual(['usdc', 'pls'])
  })
})
