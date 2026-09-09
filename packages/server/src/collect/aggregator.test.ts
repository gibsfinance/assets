import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness, createFakeTerminalRowProxy } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import { AggregatorCollector, chainListKey, type AggregatorSource } from './aggregator'
import type { AggregatorToken, ParsedCatalogue } from './aggregator-parse'

let tokenCounter = 0

/** Builds a syntactically valid `AggregatorToken`, with every field overridable. */
const buildToken = (overrides: Partial<AggregatorToken> = {}): AggregatorToken => {
  tokenCounter += 1
  const suffix = tokenCounter.toString(16).padStart(40, '0')
  return {
    chainId: 1,
    address: `0x${suffix}`,
    name: `Fixture Token ${tokenCounter}`,
    symbol: `FIX${tokenCounter}`,
    decimals: 18,
    logoURI: `https://example.com/logo-${tokenCounter}.png`,
    ...overrides,
  }
}

/** Builds a source whose already-narrowed catalogue is fixed, with every field overridable. */
const buildSource = (
  providerKey: string,
  catalogue: ParsedCatalogue,
  overrides: Partial<AggregatorSource> = {},
): AggregatorSource => ({
  providerKey,
  providerName: `Fixture ${providerKey}`,
  fetchCatalogue: vi.fn(async () => catalogue),
  ...overrides,
})

describe('AggregatorCollector', () => {
  describe('discover', () => {
    it('creates the provider once and one list per chain, each list carrying that chain network id', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 10 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))

      await collector.discover(new AbortController().signal)

      expect(harness.state.providers.map((provider) => provider.key)).toEqual(['acme'])
      expect(harness.state.lists.map((list) => list.key)).toEqual([chainListKey(1), chainListKey(10)])
      const ethereumNetwork = harness.state.networks.get('eip155-1')
      const optimismNetwork = harness.state.networks.get('eip155-10')
      expect(harness.state.lists.find((list) => list.key === chainListKey(1))?.networkId).toBe(
        ethereumNetwork?.networkId,
      )
      expect(harness.state.lists.find((list) => list.key === chainListKey(10))?.networkId).toBe(
        optimismNetwork?.networkId,
      )
    })

    it('names every list it created in the manifest it returns', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 10 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))

      const manifest = await collector.discover(new AbortController().signal)

      const listIds = harness.state.lists.map((list) => list.listId)
      expect(manifest).toEqual([
        {
          providerKey: 'acme',
          lists: [
            { listKey: chainListKey(1), listId: listIds[0] },
            { listKey: chainListKey(10), listId: listIds[1] },
          ],
        },
      ])
    })

    it('drops a repeated address within one chain before any list is written', async () => {
      const repeatedAddress = '0x9999999999999999999999999999999999999f'
      const catalogue: ParsedCatalogue = {
        tokens: [
          buildToken({ chainId: 1, address: repeatedAddress, symbol: 'FIRST' }),
          buildToken({ chainId: 1, address: repeatedAddress, symbol: 'SECOND' }),
        ],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal
      await collector.discover(signal)

      await collector.collect(signal)

      // Only the first occurrence survives, and it keeps order id zero - a second
      // insert of the same address must not shift it further down the list.
      expect(harness.state.tokenImages).toHaveLength(1)
      expect(harness.state.tokenImages[0]?.token.symbol).toBe('FIRST')
      expect(harness.state.tokenImages[0]?.listTokenOrderId).toBe(0)
    })

    it('skips a chain whose network row is refused, without losing the other chains in the run', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [
          buildToken({ chainId: 1 }),
          // Tron's real chain id, mis-numbered as an ordinary Ethereum chain. The
          // database refuses this exact id by name (isFakedEvmReference), and a new
          // aggregator chain being refused is a normal event - losing every other
          // chain in the run over one refusal is not.
          buildToken({ chainId: 728126428 }),
          buildToken({ chainId: 10 }),
        ],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal

      await collector.discover(signal)
      await collector.collect(signal)

      expect(harness.state.lists.map((list) => list.key)).toEqual([chainListKey(1), chainListKey(10)])
      expect(harness.state.networks.has('eip155-728126428')).toBe(false)
      // The survivors on either side of the refused chain both still landed - proof
      // the refusal was skipped rather than stopping the whole run partway through.
      expect(harness.state.tokenImages).toHaveLength(2)
    })

    it('writes nothing and returns an empty manifest for an empty catalogue', async () => {
      const catalogue: ParsedCatalogue = { tokens: [], rejected: {} }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))

      const manifest = await collector.discover(new AbortController().signal)

      expect(manifest).toEqual([])
      expect(harness.state.providers).toHaveLength(0)
      expect(harness.state.lists).toHaveLength(0)
    })

    it('stops before writing anything once the signal aborts while the catalogue is being fetched', async () => {
      const controller = new AbortController()
      const catalogue: ParsedCatalogue = { tokens: [buildToken({ chainId: 1 })], rejected: {} }
      const source = buildSource('acme', catalogue, {
        fetchCatalogue: vi.fn(async () => {
          controller.abort()
          return catalogue
        }),
      })
      const collector = new AggregatorCollector(source)

      const manifest = await collector.discover(controller.signal)

      expect(manifest).toEqual([])
      expect(harness.state.providers).toHaveLength(0)
    })

    it('stops creating chain lists once the signal aborts partway through the chain loop', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 10 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const controller = new AbortController()
      const originalInsertNetworkFromChainId = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
      // Abort right after the first chain's network row lands - the loop's own
      // re-check, at the top of the next iteration, is what has to stop chain ten.
      harness.dbModule.insertNetworkFromChainId.mockImplementation(
        async (chainId: unknown, type?: unknown, tx?: unknown) => {
          const result = await originalInsertNetworkFromChainId(chainId, type, tx)
          controller.abort()
          return result
        },
      )

      try {
        await collector.discover(controller.signal)
      } finally {
        harness.dbModule.insertNetworkFromChainId.mockImplementation(originalInsertNetworkFromChainId)
      }

      expect(harness.state.lists).toHaveLength(1)
    })

    it('reuses an existing terminal row across a second cycle instead of issuing a fresh one', async () => {
      const catalogue: ParsedCatalogue = { tokens: [buildToken({ chainId: 1 })], rejected: {} }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const existingRow = createFakeTerminalRowProxy()
      harness.utilsModule.terminal.get.mockReturnValueOnce(existingRow)

      await collector.discover(new AbortController().signal)

      expect(harness.utilsModule.terminal.issue).not.toHaveBeenCalled()
      expect(existingRow.complete).toHaveBeenCalledTimes(1)
    })
  })

  describe('collect', () => {
    it('inserts every token of every list, ordering each token within its own chain only', async () => {
      const chainOneTokens = [buildToken({ chainId: 1 }), buildToken({ chainId: 1 })]
      const chainTenTokens = [buildToken({ chainId: 10 }), buildToken({ chainId: 10 }), buildToken({ chainId: 10 })]
      const catalogue: ParsedCatalogue = { tokens: [...chainOneTokens, ...chainTenTokens], rejected: {} }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal
      await collector.discover(signal)

      await collector.collect(signal)

      const orderIdsFor = (tokens: AggregatorToken[]) =>
        harness.state.tokenImages
          .filter((image) => tokens.some((token) => token.address === image.token.providedId))
          .map((image) => image.listTokenOrderId)
          .sort((a, b) => a - b)
      // Chain ten's order ids restart at zero rather than continuing on from chain
      // one's count of two - a running counter across chains is the mistake this pins.
      expect(orderIdsFor(chainOneTokens)).toEqual([0, 1])
      expect(orderIdsFor(chainTenTokens)).toEqual([0, 1, 2])
    })

    it('does not let one token whose insert throws stop the tokens that come after it', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 1 }), buildToken({ chainId: 1 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal
      await collector.discover(signal)
      harness.dbModule.fetchImageAndStoreForToken.mockRejectedValueOnce(new Error('storage exploded'))

      await expect(collector.collect(signal)).resolves.toBeUndefined()

      expect(harness.state.tokenImages).toHaveLength(2)
    })

    it('does no work when the signal is already aborted before collect() starts', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 10 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      // Discovery runs first, unaborted, so any call the collect() phase makes
      // afterward can only be attributed to collect() itself.
      await collector.discover(new AbortController().signal)
      const controller = new AbortController()
      controller.abort()

      await collector.collect(controller.signal)

      expect(harness.dbModule.fetchImageAndStoreForToken).not.toHaveBeenCalled()
    })

    it('stops reaching the database for later chains once the signal aborts partway through the run', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 10 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const discoverySignal = new AbortController().signal
      await collector.discover(discoverySignal)
      const controller = new AbortController()
      // Abort as soon as the first chain's only token finishes inserting.
      harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
        controller.abort()
      })

      await collector.collect(controller.signal)

      // One call, not two - the run stopped rather than reaching every chain and
      // simply writing nothing for the second one.
      expect(harness.dbModule.fetchImageAndStoreForToken).toHaveBeenCalledTimes(1)
    })

    it('stops a later token in the same chain once the signal aborts partway through that chain', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 1 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const discoverySignal = new AbortController().signal
      await collector.discover(discoverySignal)
      const controller = new AbortController()
      // Abort as a side effect of inserting the first token - the second token in
      // this same chain's list must then see an already-aborted signal before its
      // own database call.
      harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
        controller.abort()
      })

      await collector.collect(controller.signal)

      expect(harness.dbModule.fetchImageAndStoreForToken).toHaveBeenCalledTimes(1)
    })

    it('stops opening a counter for the next chain once the signal aborts, proving the loop itself stopped', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1 }), buildToken({ chainId: 10 })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const discoverySignal = new AbortController().signal
      await collector.discover(discoverySignal)
      const row = createFakeTerminalRowProxy()
      harness.utilsModule.terminal.issue.mockReturnValueOnce(row)
      const controller = new AbortController()
      harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
        controller.abort()
      })

      await collector.collect(controller.signal)

      // A counter is created once per chain the loop actually enters. Only one
      // counter here means the second chain's iteration never began.
      expect(row.createCounter).toHaveBeenCalledTimes(1)
    })

    it('writes nothing rather than throwing when collect() runs before discover()', async () => {
      const catalogue: ParsedCatalogue = { tokens: [buildToken({ chainId: 1 })], rejected: {} }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))

      await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()

      expect(harness.dbModule.fetchImageAndStoreForToken).not.toHaveBeenCalled()
      expect(harness.utilsModule.terminal.issue).not.toHaveBeenCalled()
    })

    it('normalizes the token address before writing it as providedId', async () => {
      // A real, checksum-valid mixed-case address - normalizeProvidedId only lowercases
      // a value viem recognizes as an address, so an arbitrary mixed-case string would
      // not exercise the same path.
      const mixedCaseAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1, address: mixedCaseAddress })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal
      await collector.discover(signal)

      await collector.collect(signal)

      expect(harness.dbModule.normalizeProvidedId).toHaveBeenCalledWith(mixedCaseAddress)
      expect(harness.state.tokenImages[0]?.token.providedId).toBe(mixedCaseAddress.toLowerCase())
    })

    it('passes a missing logo through as null, never as an empty string', async () => {
      const catalogue: ParsedCatalogue = {
        tokens: [buildToken({ chainId: 1, logoURI: null })],
        rejected: {},
      }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal
      await collector.discover(signal)

      await collector.collect(signal)

      expect(harness.state.tokenImages[0]?.uri).toBeNull()
      expect(harness.state.tokenImages[0]?.originalUri).toBeNull()
    })

    it('reuses an existing terminal row instead of issuing a fresh one', async () => {
      const catalogue: ParsedCatalogue = { tokens: [buildToken({ chainId: 1 })], rejected: {} }
      const collector = new AggregatorCollector(buildSource('acme', catalogue))
      const signal = new AbortController().signal
      await collector.discover(signal)
      harness.utilsModule.terminal.issue.mockClear()
      const existingRow = createFakeTerminalRowProxy()
      harness.utilsModule.terminal.get.mockReturnValueOnce(existingRow)

      await collector.collect(signal)

      expect(harness.utilsModule.terminal.issue).not.toHaveBeenCalled()
      expect(existingRow.complete).toHaveBeenCalledTimes(1)
    })
  })
})
