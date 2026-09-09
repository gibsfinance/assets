/**
 * The three aggregator sources, as distinct from the collector they share.
 *
 * Each of these files is small on purpose — a location, how to ask it, and
 * which parser reads the answer — and every one of those three is a claim that
 * can be wrong in a way no parser test would notice. A renamed endpoint, a
 * dropped `verified: true`, or a response handed to the wrong parser all leave
 * the parsers passing and the collector producing nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

import * as lifi from './lifi'
import * as relay from './relay'
import * as nearIntents from './near-intents'

const signal = new AbortController().signal

beforeEach(() => {
  harness.reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('lifi source', () => {
  it('asks LiFi for its whole token catalogue', () => {
    // A renamed path answers 404, the parser reads no tokens from it, and the
    // collector reports an empty catalogue rather than an error. Pinning the
    // location is what turns that silence into a failing test.
    expect(lifi.TOKENS_URL).toBe('https://li.quest/v1/tokens')
  })

  it('caches the response under the address it came from', async () => {
    // Two arguments carry the cache key. Passing anything else there would give
    // every collect run a fresh six-megabyte download.
    harness.dbModule.cachedJSONRequest.mockResolvedValue({ tokens: {} })
    await lifi.fetchCatalogue(signal)
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledWith(lifi.TOKENS_URL, signal, lifi.TOKENS_URL)
  })

  it('reads the response with the parser that knows LiFi shape', async () => {
    harness.dbModule.cachedJSONRequest.mockResolvedValue({
      tokens: {
        '1': [
          {
            chainId: 1,
            address: '0xabc',
            name: 'Token',
            symbol: 'TKN',
            decimals: 18,
            logoURI: 'https://example.test/a.png',
            verificationStatus: 'verified',
          },
          {
            chainId: 1,
            address: '0xdef',
            name: 'Scam',
            symbol: 'SCM',
            decimals: 18,
            logoURI: 'https://example.test/b.png',
            verificationStatus: 'flagged',
          },
        ],
      },
    })
    const { tokens } = await lifi.fetchCatalogue(signal)
    // One kept, one refused: proof the verification verdict is being read here
    // and not merely somewhere in the parser's own tests.
    expect(tokens.map((token) => token.symbol)).toEqual(['TKN'])
  })
})

describe('relay source', () => {
  it('asks Relay for its currency catalogue', () => {
    expect(relay.CURRENCIES_URL).toBe('https://api.relay.link/currencies/v1')
  })

  it('asks only for verified currencies, and for far more than Relay holds', async () => {
    // Both halves matter. Without `verified` the response carries outright spam
    // beside real tokens. The limit is a ceiling rather than a page size —
    // Relay accepts `offset` and ignores it, so a limit tuned to today's count
    // would silently truncate the day the catalogue grew past it.
    harness.fetchModule.fetch.mockResolvedValue({ json: async () => [] })
    await relay.fetchCatalogue(signal)

    const [url, options] = harness.fetchModule.fetch.mock.calls[0] as [string, { method: string; body: string }]
    expect(url).toBe(relay.CURRENCIES_URL)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ verified: true, limit: relay.CATALOGUE_LIMIT })
    expect(relay.CATALOGUE_LIMIT).toBeGreaterThan(20_000)
  })

  it('passes the abort signal through, so a shutdown reaches the request', async () => {
    harness.fetchModule.fetch.mockResolvedValue({ json: async () => [] })
    await relay.fetchCatalogue(signal)
    const [, options] = harness.fetchModule.fetch.mock.calls[0] as [string, { signal: AbortSignal }]
    expect(options.signal).toBe(signal)
  })

  it('reads the response with the parser that knows Relay shape', async () => {
    harness.fetchModule.fetch.mockResolvedValue({
      json: async () => [
        [
          {
            chainId: 1,
            address: '0xabc',
            name: 'Tether USD',
            symbol: 'USDT',
            decimals: 6,
            vmType: 'evm',
            metadata: { logoURI: 'https://example.test/usdt.png', verified: true },
          },
        ],
        [
          {
            chainId: 728126428,
            address: 'TXYZ',
            name: 'Tron thing',
            symbol: 'TRX',
            decimals: 6,
            vmType: 'tvm',
            metadata: { logoURI: '', verified: true },
          },
        ],
      ],
    })
    const { tokens } = await relay.fetchCatalogue(signal)
    // The Tron entry is refused here, which is what keeps its chain number —
    // one the database rejects by name — from ever reaching the database.
    expect(tokens.map((token) => token.symbol)).toEqual(['USDT'])
  })
})

describe('near intents source', () => {
  it('asks NEAR Intents for the assets it settles', () => {
    expect(nearIntents.TOKENS_URL).toBe('https://1click.chaindefuser.com/v0/tokens')
  })

  it('caches the response under the address it came from', async () => {
    harness.dbModule.cachedJSONRequest.mockResolvedValue([])
    await nearIntents.fetchCatalogue(signal)
    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledWith(
      nearIntents.TOKENS_URL,
      signal,
      nearIntents.TOKENS_URL,
    )
  })

  it('reads the response with the parser that knows NEAR Intents shape', async () => {
    harness.dbModule.cachedJSONRequest.mockResolvedValue([
      { blockchain: 'eth', symbol: 'USDT', decimals: 6, contractAddress: '0xdac1' },
      { blockchain: 'near', symbol: 'wNEAR', decimals: 24, contractAddress: 'wrap.near' },
    ])
    const { tokens } = await nearIntents.fetchCatalogue(signal)
    // The NEAR-native asset is refused: this collector files Ethereum Virtual
    // Machine chains only, and no verified identity exists here for the rest.
    expect(tokens.map((token) => token.symbol)).toEqual(['USDT'])
  })
})

describe('the standalone entry points', () => {
  it.each([
    ['lifi', lifi],
    ['relay', relay],
    ['near-intents', nearIntents],
  ])('%s runs discover before collect, in that order', async (_name, source) => {
    // The two-phase contract is the whole point: order sync runs between them,
    // so a collect that ran first would insert tokens under no ranking at all.
    const order: string[] = []
    const collector = source.default as unknown as {
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

    await source.collect(signal)

    expect(order).toEqual(['discover', 'collect'])
  })
})
