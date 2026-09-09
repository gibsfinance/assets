/**
 * deBridge sits on the same shared aggregator shape as LiFi, Relay, and NEAR
 * Intents (see `aggregator-sources.test.ts`), but it is the one source here
 * that takes two requests per run instead of one, and whose two request
 * fields mean different things. These tests reuse the same harness pattern
 * as the sibling sources and add the coverage that difference calls for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

import * as debridge from './debridge'

const signal = new AbortController().signal

beforeEach(() => {
  harness.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The `supported-chains-info` body shape, trimmed to what `parseChainList` reads. */
const buildChainsBody = (chains: { chainId: number; originalChainId: number; chainName?: string }[]) => ({
  chains,
})

/** The `token-list` body shape, trimmed to what `parseChainTokens` reads. */
const buildTokenListBody = (
  tokens: Record<string, { address: string; name?: string; symbol: string; decimals: number; logoURI?: string }>,
) => ({ tokens })

/**
 * Routes the mocked `cachedJSONRequest` by the address it was asked for,
 * rather than one fixed answer for every call - `fetchCatalogue` makes one
 * request for the chain list and a separate one per chain, so a single
 * `mockResolvedValue` cannot tell them apart. A call for an address with no
 * entry here throws, the same "you forgot to arrange this" contract the
 * harness's own queuing helpers use.
 */
const queueByUrl = (responses: Record<string, unknown | Error>) => {
  harness.dbModule.cachedJSONRequest.mockImplementation(async (key: string) => {
    if (!(key in responses)) {
      throw new Error(`debridge.test: no fixture queued for "${key}"`)
    }
    const response = responses[key]
    if (response instanceof Error) throw response
    return response
  })
}

describe('debridge source', () => {
  it('names the supported-chains endpoint', () => {
    expect(debridge.CHAINS_URL).toBe('https://dln.debridge.finance/v1.0/supported-chains-info')
  })

  it("builds the token list address from deBridge's own request number, not the real chain id", () => {
    // HyperEVM's real chain id is 999, but the token endpoint only answers to
    // deBridge's internal number, 100000022. Asking it for 999 would return
    // nothing, or another chain's tokens entirely.
    expect(debridge.tokenListUrl(100000022)).toBe('https://dln.debridge.finance/v1.0/token-list?chainId=100000022')
  })

  it("fetches the chain list first, then one token list per chain, filing each chain's tokens under its real id", async () => {
    queueByUrl({
      [debridge.CHAINS_URL]: buildChainsBody([
        { chainId: 1, originalChainId: 1, chainName: 'Ethereum' },
        { chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' },
      ]),
      [debridge.tokenListUrl(1)]: buildTokenListBody({
        '0xa': { address: '0xa', name: 'Ether Token', symbol: 'ETK', decimals: 18 },
      }),
      [debridge.tokenListUrl(100000022)]: buildTokenListBody({
        '0xb': { address: '0xb', name: 'Hyper Token', symbol: 'HTK', decimals: 18 },
      }),
    })

    const result = await debridge.fetchCatalogue(signal)

    // Filed under 1 and 999 - the real chain ids - and not under 100000022,
    // the request number the second chain's tokens were fetched with.
    expect(result.tokens.map((token) => [token.chainId, token.symbol])).toEqual([
      [1, 'ETK'],
      [999, 'HTK'],
    ])
  })

  it('excludes Solana and Tron before their token lists are ever requested', async () => {
    queueByUrl({
      [debridge.CHAINS_URL]: buildChainsBody([
        { chainId: 1, originalChainId: 1, chainName: 'Ethereum' },
        { chainId: 7565164, originalChainId: 7565164, chainName: 'Solana' },
        { chainId: 100000026, originalChainId: 728126428, chainName: 'Tron' },
      ]),
      [debridge.tokenListUrl(1)]: buildTokenListBody({
        '0xa': { address: '0xa', name: 'Ether Token', symbol: 'ETK', decimals: 18 },
      }),
    })

    const result = await debridge.fetchCatalogue(signal)

    // Only the chain list request and Ethereum's token list ran. A request for
    // Solana's or Tron's token list, with no fixture queued for it, would have
    // thrown - it never happened.
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledTimes(2)
    expect(result.tokens.map((token) => token.chainId)).toEqual([1])
  })

  it('counts and skips a chain whose token list fails, and still returns the other chains', async () => {
    queueByUrl({
      [debridge.CHAINS_URL]: buildChainsBody([
        { chainId: 1, originalChainId: 1, chainName: 'Ethereum' },
        { chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' },
        { chainId: 100000030, originalChainId: 143, chainName: 'Monad' },
      ]),
      [debridge.tokenListUrl(1)]: buildTokenListBody({
        '0xa': { address: '0xa', name: 'Ether Token', symbol: 'ETK', decimals: 18 },
      }),
      [debridge.tokenListUrl(100000022)]: new Error('gateway timeout'),
      [debridge.tokenListUrl(100000030)]: buildTokenListBody({
        '0xc': { address: '0xc', name: 'Monad Token', symbol: 'MTK', decimals: 18 },
      }),
    })

    const result = await debridge.fetchCatalogue(signal)

    // The middle chain failing must not cost the survivors: the proof is that
    // both Ethereum's and Monad's tokens actually landed, not merely that
    // nothing threw.
    expect(result.tokens.map((token) => [token.chainId, token.symbol])).toEqual([
      [1, 'ETK'],
      [143, 'MTK'],
    ])
    expect(result.rejected).toEqual({ 'chain token list unavailable': 1 })
  })

  it('returns empty with a counted reason, and fetches nothing else, when the chain list cannot be read', async () => {
    queueByUrl({ [debridge.CHAINS_URL]: { chains: 'not an array' } })

    const result = await debridge.fetchCatalogue(signal)

    expect(result).toEqual({ tokens: [], rejected: { 'chain list unreadable': 1 } })
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledTimes(1)
  })

  it('sums rejection reasons across every chain, rather than the last chain overwriting the rest', async () => {
    queueByUrl({
      [debridge.CHAINS_URL]: buildChainsBody([
        { chainId: 1, originalChainId: 1, chainName: 'Ethereum' },
        { chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' },
      ]),
      [debridge.tokenListUrl(1)]: buildTokenListBody({
        noSymbol: { address: '0xa', name: 'No Symbol', decimals: 18 } as never,
      }),
      [debridge.tokenListUrl(100000022)]: buildTokenListBody({
        alsoNoSymbol: { address: '0xb', name: 'Also No Symbol', decimals: 18 } as never,
      }),
    })

    const result = await debridge.fetchCatalogue(signal)

    expect(result.rejected).toEqual({ 'no symbol': 2 })
  })

  it('stops fetching once the signal is aborted, rather than working through the remaining chains', async () => {
    const controller = new AbortController()
    queueByUrl({
      [debridge.CHAINS_URL]: buildChainsBody([
        { chainId: 1, originalChainId: 1, chainName: 'Ethereum' },
        { chainId: 100000022, originalChainId: 999, chainName: 'HyperEVM' },
      ]),
    })
    controller.abort()

    const result = await debridge.fetchCatalogue(controller.signal)

    // Only the chain list request happened. A loop that kept running would
    // have asked for at least one chain's token list, with no fixture queued
    // for it - and that call would have thrown rather than quietly returning
    // nothing.
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledTimes(1)
    expect(result.tokens).toEqual([])
  })

  it('caches every request under the address it came from', async () => {
    queueByUrl({
      [debridge.CHAINS_URL]: buildChainsBody([{ chainId: 1, originalChainId: 1, chainName: 'Ethereum' }]),
      [debridge.tokenListUrl(1)]: buildTokenListBody({
        '0xa': { address: '0xa', name: 'Ether Token', symbol: 'ETK', decimals: 18 },
      }),
    })

    await debridge.fetchCatalogue(signal)

    expect(harness.dbModule.cachedJSONRequest).toHaveBeenNthCalledWith(
      1,
      debridge.CHAINS_URL,
      signal,
      debridge.CHAINS_URL,
    )
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenNthCalledWith(
      2,
      debridge.tokenListUrl(1),
      signal,
      debridge.tokenListUrl(1),
    )
  })

  it('runs discover before collect, in that order', async () => {
    // The two-phase contract is the whole point: order sync runs between them,
    // so a collect that ran first would insert tokens under no ranking at all.
    const order: string[] = []
    const collector = debridge.default as unknown as {
      discover: (signal: AbortSignal) => Promise<unknown>
      collect: (signal: AbortSignal) => Promise<void>
    }
    vi.spyOn(collector, 'discover').mockImplementation(async () => {
      order.push('discover')
      return []
    })
    vi.spyOn(collector, 'collect').mockImplementation(async () => {
      order.push('collect')
    })

    await debridge.collect(signal)

    expect(order).toEqual(['discover', 'collect'])
  })
})
