import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
// `limitByTime` (the between-chunk rate limiter) is real and dependency-free — kept
// so its own wait actually happens (and is flushed by fake timers), not mocked away.

beforeEach(() => {
  harness.reset()
  delete process.env.COINGECKO_API_KEY
  vi.useFakeTimers({ now: 0 })
  // coingecko.ts calls the bare global `fetch` (not the project's `../fetch` wrapper) —
  // stub the same queue-backed mock the rest of this directory's collectors reach via
  // `vi.mock('../fetch', ...)`, so it is covered by the identical "no real network"
  // guarantee and the identical `queueFetchResponse` fixture contract.
  vi.stubGlobal('fetch', harness.fetchModule.fetch)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

import CoinGeckoCollector, { collect } from './coingecko'

const API_BASE = 'https://api.coingecko.com/api/v3'
const PLATFORMS_URL = `${API_BASE}/asset_platforms`
const COINS_LIST_URL = `${API_BASE}/coins/list?include_platform=true`
const marketsUrl = (ids: string[]) => `${API_BASE}/coins/markets?ids=${ids.join(',')}&vs_currency=usd&per_page=250`

const evmPlatform = { id: 'ethereum', chain_identifier: 1, name: 'Ethereum' }
const solanaPlatform = { id: 'solana', chain_identifier: null, name: 'Solana' }
const unsupportedPlatform = { id: 'some-cosmos-chain', chain_identifier: null, name: 'Some Cosmos Chain' }

const evmCoin = {
  id: 'fixture-evm-coin',
  symbol: 'fec',
  name: 'Fixture EVM Coin',
  platforms: { ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
}

/** A `collect()`/`discover()` run under fake timers, with every pending timer (rate-limit waits, backoff) flushed. */
const runUnderFakeTimers = async <T>(run: Promise<T>): Promise<T> => {
  run.catch(() => {})
  await vi.runAllTimersAsync()
  return run
}

describe('coingecko collector', () => {
  describe('discover()', () => {
    it('builds one list per resolvable platform from asset_platforms + coins/list', async () => {
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform, solanaPlatform, unsupportedPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin] })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(harness.state.providers.map((p) => p.key)).toEqual(['coingecko'])
      expect(manifest).toEqual([{ providerKey: 'coingecko', lists: [{ listKey: '1' }] }])
      const network = [...harness.state.networks.values()].find((n) => n.chainId === 'eip155-1')
      expect(network).toBeDefined()
    })

    it('resolves a supported non-EVM platform (solana) alongside EVM ones', async () => {
      const solanaCoin = {
        id: 'fixture-sol-coin',
        symbol: 'fsc',
        name: 'Fixture Sol Coin',
        platforms: { solana: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      }
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform, solanaPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin, solanaCoin] })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest[0]!.lists.map((l) => l.listKey).sort()).toEqual(['1', 'solana-501'])
    })

    it('reports the monthly call limit distinctly from any other non-array response', async () => {
      const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      harness.queueFetchResponse(PLATFORMS_URL, { body: { status: { error_code: 10006, error_message: 'limit' } } })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('monthly call limit exhausted'))
      warnSpy.mockRestore()
    })

    it('warns and returns an empty manifest on any other non-array asset_platforms response', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      harness.queueFetchResponse(PLATFORMS_URL, { body: { unexpected: true } })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith('[coingecko] asset_platforms returned non-array — %o', {
        unexpected: true,
      })
      warnSpy.mockRestore()
    })

    it('warns and returns an empty manifest when coins/list is not an array', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: { unexpected: true } })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest).toEqual([])
      warnSpy.mockRestore()
    })

    it('warns and returns an empty manifest when no coin resolves to a supported platform', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      harness.queueFetchResponse(PLATFORMS_URL, { body: [unsupportedPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [{ id: 'x', symbol: 'x', name: 'x', platforms: {} }] })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith('[coingecko] no tokens found in coins/list')
      warnSpy.mockRestore()
    })

    it('signs requests with an api key when COINGECKO_API_KEY is set (and switches to the pro API host)', async () => {
      process.env.COINGECKO_API_KEY = 'test-cg-key'
      const proBase = 'https://pro-api.coingecko.com/api/v3'
      harness.queueFetchResponse(`${proBase}/asset_platforms?x_cg_pro_api_key=test-cg-key`, { body: [evmPlatform] })
      harness.queueFetchResponse(`${proBase}/coins/list?include_platform=true&x_cg_pro_api_key=test-cg-key`, {
        body: [evmCoin],
      })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest).toEqual([{ providerKey: 'coingecko', lists: [{ listKey: '1' }] }])
    })
  })

  describe('collect()', () => {
    const discoverOnePlatform = async (collector: CoinGeckoCollector) => {
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin] })
      await runUnderFakeTimers(collector.discover(new AbortController().signal))
    }

    it('skips entirely when discover() found no platforms', async () => {
      const collector = new CoinGeckoCollector()
      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('inserts a token once its coins/markets image is fetched', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), {
        body: [{ id: evmCoin.id, image: 'https://assets.coingecko.com/coins/images/1/large/fixture.png' }],
      })

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      const image = harness.state.tokenImages.find(
        (i) => i.token.providedId === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      )
      expect(image?.uri).toBe('https://assets.coingecko.com/coins/images/1/large/fixture.png')
    })

    it('skips a coin the markets endpoint reports no image for', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), { body: [{ id: evmCoin.id }] })

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('does not let one image-store failure stop the rest of the chunk', async () => {
      const otherCoin = {
        id: 'fixture-evm-coin-2',
        symbol: 'fec2',
        name: 'Fixture EVM Coin 2',
        // All-lowercase — `isValidPlatformAddress` accepts either an EIP-55 checksum or
        // an all-lowercase address; a hand-edited mixed-case string (like a one-character
        // tweak of `evmCoin`'s real checksummed address) fails checksum validation and
        // gets silently dropped before it ever reaches the markets fetch.
        platforms: { ethereum: '0xb0b86991c6218b36c1d19d4a2e9eb0ce3606eb49' },
      }
      const collector = new CoinGeckoCollector()
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin, otherCoin] })
      await runUnderFakeTimers(collector.discover(new AbortController().signal))
      harness.queueFetchResponse(marketsUrl([evmCoin.id, otherCoin.id]), {
        body: [
          { id: evmCoin.id, image: 'https://assets.coingecko.com/coins/images/1/large/fixture.png' },
          { id: otherCoin.id, image: 'https://assets.coingecko.com/coins/images/2/large/fixture2.png' },
        ],
      })
      harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
        throw new Error('image store exploded')
      })

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      const survivor = harness.state.tokenImages.find(
        (i) => i.token.providedId === '0xb0b86991c6218b36c1d19d4a2e9eb0ce3606eb49',
      )
      expect(survivor).toBeDefined()
    })

    it('retries a 429 with a 60-second backoff before succeeding', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), { status: 429 })
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), {
        body: [{ id: evmCoin.id, image: 'https://assets.coingecko.com/coins/images/1/large/fixture.png' }],
      })

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      const image = harness.state.tokenImages.find(
        (i) => i.token.providedId === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      )
      expect(image).toBeDefined()
      const marketsCalls = harness.fetchModule.fetch.mock.calls.filter(
        (call) => call[0].toString() === marketsUrl([evmCoin.id]),
      )
      expect(marketsCalls).toHaveLength(2)
    })

    it('retries a non-429 failure with a linear backoff, then gives up after 5 retries', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      for (let i = 0; i < 6; i++) {
        harness.queueFetchResponse(marketsUrl([evmCoin.id]), { status: 500, statusText: 'Internal Server Error' })
      }

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      // Exhausted every retry — no image was ever recorded, and nothing crashed.
      expect(harness.state.tokenImages).toHaveLength(0)
      const marketsCalls = harness.fetchModule.fetch.mock.calls.filter(
        (call) => call[0].toString() === marketsUrl([evmCoin.id]),
      )
      expect(marketsCalls).toHaveLength(6)
    })

    it('treats a non-array coins/markets response as no images, without crashing the chunk', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), { body: { unexpected: true } })

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      // Not an array, so `imageMap` never gets populated — the coin is skipped, not stored.
      expect(harness.state.tokenImages).toHaveLength(0)
    })

    it('falls back to String(err) — rather than crashing — when a non-Error value is thrown mid-retry', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      harness.fetchModule.fetch.mockImplementationOnce(() => {
        throw 'a plain string rejection'
      })
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), {
        body: [{ id: evmCoin.id, image: 'https://assets.coingecko.com/coins/images/1/large/fixture.png' }],
      })

      await runUnderFakeTimers(collector.collect(new AbortController().signal))

      // Recovered on the second attempt — the non-Error throw did not crash the retry loop.
      const image = harness.state.tokenImages.find(
        (i) => i.token.providedId === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      )
      expect(image).toBeDefined()
      // `String(err)` (not `err.message`) is what produced this log line — proves the
      // `instanceof Error` ternary's other branch actually ran rather than throwing
      // trying to read `.message` off a string.
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('a plain string rejection'))
      logSpy.mockRestore()
    })

    it('drops a coin past the insert concurrency limit (4) once the signal aborts mid-batch', async () => {
      const collector = new CoinGeckoCollector()
      const coins = Array.from({ length: 5 }, (_, i) => ({
        id: `fixture-coin-${i}`,
        symbol: `fc${i}`,
        name: `Fixture Coin ${i}`,
        platforms: { ethereum: `0x${(i + 1).toString(16).padStart(40, '0')}` },
      }))
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: coins })
      await runUnderFakeTimers(collector.discover(new AbortController().signal))

      const controller = new AbortController()
      const ids = coins.map((c) => c.id)
      harness.queueFetchResponse(marketsUrl(ids), {
        body: coins.map((c) => ({
          id: c.id,
          image: `https://assets.coingecko.com/coins/images/${c.id}/large/fixture.png`,
        })),
      })

      let releaseGate: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      let gatedCalls = 0
      const originalStore = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
      harness.dbModule.fetchImageAndStoreForToken.mockImplementation(async (input: unknown, tx?: unknown) => {
        gatedCalls += 1
        await gate
        return originalStore(input, tx)
      })

      try {
        const run = collector.collect(controller.signal)
        run.catch(() => {})
        // The between-chunk rate limiter (`limitByTime`, real — not mocked) gates the
        // markets fetch behind a real 15-second timer (anonymous tier) before any of
        // this even starts, so the flush needs to advance fake timers, not just
        // microtasks, to get there at all.
        await vi.advanceTimersByTimeAsync(15_000)
        // `insertLimit` caps concurrency at 4 — the 5th coin is queued behind the limiter
        // and only dequeued once one of the first 4 completes, a genuine asynchronous gap
        // in which the signal can (and here does) abort before the 5th's own check runs.
        let iterations = 0
        while (gatedCalls < 4 && iterations < 2000) {
          await Promise.resolve()
          iterations += 1
        }
        expect(gatedCalls).toBe(4)
        controller.abort()
        releaseGate()
        await vi.runAllTimersAsync()
        await run
      } finally {
        harness.dbModule.fetchImageAndStoreForToken.mockImplementation(originalStore)
      }

      expect(harness.state.tokenImages).toHaveLength(4)
    })

    it('stops walking chunks once the signal aborts', async () => {
      const collector = new CoinGeckoCollector()
      await discoverOnePlatform(collector)
      const controller = new AbortController()
      controller.abort()

      await runUnderFakeTimers(collector.collect(controller.signal))

      expect(harness.state.tokenImages).toHaveLength(0)
      expect(harness.fetchModule.fetch.mock.calls.some((call) => call[0].toString().includes('/coins/markets'))).toBe(
        false,
      )
    })
  })

  it('the standalone collect() export runs discover() then collect() on a fresh instance', async () => {
    harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
    harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin] })
    harness.queueFetchResponse(marketsUrl([evmCoin.id]), {
      body: [{ id: evmCoin.id, image: 'https://assets.coingecko.com/coins/images/1/large/fixture.png' }],
    })

    await runUnderFakeTimers(collect(new AbortController().signal))

    expect(harness.state.providers.map((p) => p.key)).toEqual(['coingecko'])
    expect(harness.state.tokenImages).toHaveLength(1)
  })

  describe('discover() coin filtering', () => {
    it('skips a coin with no platforms object, an unresolved platform, and an invalid address, keeping only the valid one', async () => {
      const platformless = { id: 'no-platforms', symbol: 'np', name: 'No Platforms' }
      const unresolvedPlatform = {
        id: 'unresolved-platform',
        symbol: 'up',
        name: 'Unresolved Platform',
        platforms: { 'not-a-real-platform': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      }
      const invalidAddress = {
        id: 'invalid-address',
        symbol: 'ia',
        name: 'Invalid Address',
        platforms: { ethereum: 'not-a-hex-address' },
      }
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, {
        body: [platformless, unresolvedPlatform, invalidAddress, evmCoin],
      })

      const collector = new CoinGeckoCollector()
      const manifest = await runUnderFakeTimers(collector.discover(new AbortController().signal))

      expect(manifest).toEqual([{ providerKey: 'coingecko', lists: [{ listKey: '1' }] }])
    })
  })

  describe('collect() abort handling', () => {
    const twoPlatformCoin = {
      id: 'fixture-optimism-coin',
      symbol: 'foc',
      name: 'Fixture Optimism Coin',
      // All-lowercase — see the `otherCoin` fixture above for why a hand-edited
      // mixed-case address is the wrong way to get "a second, different address".
      platforms: { optimism: '0xc0b86991c6218b36c1d19d4a2e9eb0ce3606eb50' },
    }
    const optimismPlatform = { id: 'optimism', chain_identifier: 10, name: 'Optimism' }

    it('stops as soon as an already-aborted signal is seen inside the retry catch handler', async () => {
      const collector = new CoinGeckoCollector()
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin] })
      await runUnderFakeTimers(collector.discover(new AbortController().signal))

      const controller = new AbortController()
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), { status: 500, statusText: 'Internal Server Error' })
      // Abort while the first (failing) call is in flight — settled before the
      // `!r.ok` check even runs, so the `catch` block's own `if (signal.aborted)
      // return` (rather than a plain retry) is what ends the loop.
      const originalFetch = harness.fetchModule.fetch.getMockImplementation()!
      harness.fetchModule.fetch.mockImplementationOnce(async (url: string | URL, init?: unknown) => {
        const result = await originalFetch(url, init)
        controller.abort()
        return result
      })

      await runUnderFakeTimers(collector.collect(controller.signal))

      expect(harness.state.tokenImages).toHaveLength(0)
      const marketsCalls = harness.fetchModule.fetch.mock.calls.filter(
        (call) => call[0].toString() === marketsUrl([evmCoin.id]),
      )
      expect(marketsCalls).toHaveLength(1)
    })

    it('stops before starting a fresh retry attempt once the signal aborts during the backoff wait', async () => {
      const collector = new CoinGeckoCollector()
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin] })
      await runUnderFakeTimers(collector.discover(new AbortController().signal))

      const controller = new AbortController()
      harness.queueFetchResponse(marketsUrl([evmCoin.id]), { status: 500, statusText: 'Internal Server Error' })

      const run = collector.collect(controller.signal)
      run.catch(() => {})
      // Flush through the rate limiter's own 15-second gate (`{ now: 0 }` means even
      // the *first* chunk starts the loop already "due"), then through the first
      // (failing) fetch and into its linear backoff `delay` — without letting that
      // delay's timer fire — then abort so the *next* loop iteration's top-of-loop
      // guard (before trying again) is what stops the retry, rather than the catch
      // handler.
      await vi.advanceTimersByTimeAsync(15_000)
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      await vi.runAllTimersAsync()
      await run

      expect(harness.state.tokenImages).toHaveLength(0)
      const marketsCalls = harness.fetchModule.fetch.mock.calls.filter(
        (call) => call[0].toString() === marketsUrl([evmCoin.id]),
      )
      expect(marketsCalls).toHaveLength(1)
    })

    it('stops walking platforms partway through the token-insert phase once the signal aborts', async () => {
      const collector = new CoinGeckoCollector()
      harness.queueFetchResponse(PLATFORMS_URL, { body: [evmPlatform, optimismPlatform] })
      harness.queueFetchResponse(COINS_LIST_URL, { body: [evmCoin, twoPlatformCoin] })
      await runUnderFakeTimers(collector.discover(new AbortController().signal))

      const controller = new AbortController()
      harness.queueFetchResponse(marketsUrl([evmCoin.id, twoPlatformCoin.id]), {
        body: [
          { id: evmCoin.id, image: 'https://assets.coingecko.com/coins/images/1/large/fixture.png' },
          { id: twoPlatformCoin.id, image: 'https://assets.coingecko.com/coins/images/2/large/fixture2.png' },
        ],
      })
      // Abort once the first platform's only token finishes storing, so the *second*
      // platform's `for (const [platformId, coins] of this.platformCoins)` iteration
      // sees an already-aborted signal instead of processing its own coin.
      const originalFetchImageAndStoreForToken = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
      harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async (input: unknown, tx?: unknown) => {
        const result = await originalFetchImageAndStoreForToken(input, tx)
        controller.abort()
        return result
      })

      await runUnderFakeTimers(collector.collect(controller.signal))

      // Exactly one platform's token made it in — the other was abandoned mid-run.
      expect(harness.state.tokenImages).toHaveLength(1)
    })
  })
})
