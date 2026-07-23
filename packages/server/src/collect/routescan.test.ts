import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness, createFakeTerminalRowProxy, createFakeTerminalSectionProxy } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
vi.mock('@gibs/utils/viem', () => harness.gibsUtilsViemModule)

beforeEach(() => {
  harness.reset()
  delete process.env.ROUTESCAN_API_KEY
  // A fixed epoch, not "now": `RateLimitedChainProcessor` (see below) is a
  // module-level singleton whose `lastRequestTime` survives between tests, so
  // resetting the fake clock to the *real* wall-clock "now" on every test would
  // make each test's `Date.now() - lastRequestTime` gap depend on how much real
  // time the previous tests happened to take — flaky by construction. Pinning
  // the clock to 0 every time makes that gap (and which branch it takes)
  // reproducible regardless of test order or real execution speed.
  vi.useFakeTimers({ now: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

import routescan, { collect } from './routescan'

/**
 * `RateLimitedChainProcessor` (module-private in `routescan.ts`) is a
 * module-level singleton: its `lastRequestTime` survives between tests in
 * this file, so a chain processed shortly after a previous test's chain
 * reliably lands on the "wait out the remaining 500ms" branch — real time
 * this harness must not spend waiting on. Runs `collect()` under fake timers
 * and flushes every pending timer (that 500ms rate-limit delay, and
 * `backfillTokenMetadata`'s 5s RPC timeout race) instantly instead.
 */
const runCollect = async (signal: AbortSignal) => {
  const run = collect(signal)
  // Mark `run` as handled immediately so a rejection (the two "throws" tests below)
  // is never reported as an unhandled rejection during the `runAllTimersAsync` await —
  // the caller still observes the real rejection through the returned/awaited `run`.
  run.catch(() => {})
  await vi.runAllTimersAsync()
  return run
}

const BLOCKCHAINS_URL = 'https://api.routescan.io/v2/network/mainnet/evm/all/blockchains?ecosystem=ethereum'

const tokensUrl = (chainId: number, options: { nextToken?: string; apiKey?: string } = {}) => {
  const qs = new URLSearchParams({ limit: '100', includedChainIds: chainId.toString() })
  if (options.apiKey) qs.set('apiKey', options.apiKey)
  if (options.nextToken) qs.set('nextToken', options.nextToken)
  return `https://api.routescan.io/v2/network/mainnet/evm/all/erc20?${qs.toString()}`
}

type FixtureBlockchain = {
  name: string
  chainId: string
  freeApiRateLimit: { rps: number; rpd: number }
}

const buildBlockchain = (overrides: Partial<FixtureBlockchain> = {}): FixtureBlockchain => ({
  name: 'Ethereum',
  chainId: '1',
  freeApiRateLimit: { rps: 5, rpd: 1000 },
  ...overrides,
})

type FixtureTokenItem = {
  chainId: string
  address: string
  name: string
  symbol: string
  decimals: number
  totalSupply: string
  price: string
  marketCap: string
  createOperation: { timestamp: string; txHash: string }
  transfers: { last24h: number; last48h: number; last72h: number }
  holdersCount: number
}

const buildTokenItem = (overrides: Partial<FixtureTokenItem> = {}): FixtureTokenItem => ({
  chainId: '1',
  address: '0x1111111111111111111111111111111111111a',
  name: 'Fixture Token',
  symbol: 'FIX',
  decimals: 18,
  totalSupply: '1000000',
  price: '1.00',
  marketCap: '1000000',
  createOperation: { timestamp: '0', txHash: '0xabc' },
  transfers: { last24h: 0, last48h: 0, last72h: 0 },
  holdersCount: 1,
  ...overrides,
})

/**
 * `row.get(providerKey)` is expected — by `routescan.ts` itself — to find the
 * section `row.issue(providerKey)` created a moment earlier, but this harness's
 * fake row/section proxies do not correlate `.issue()`/`.get()` by id (see
 * `createFakeTerminalSectionProxy`'s doc comment) — arm it explicitly so
 * `processChainTokens`'s `row.get(providerKey)!` resolves to a real section
 * instead of `null`.
 */
const armRowWithGettableSection = () => {
  const row = createFakeTerminalRowProxy()
  const section = createFakeTerminalSectionProxy()
  row.get.mockReturnValue(section)
  harness.utilsModule.terminal.issue.mockReturnValueOnce(row)
  return { row, section }
}

describe('routescan collector', () => {
  it('registers a provider and a single "top-tokens" list during discover()', async () => {
    const manifest = await routescan.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['routescan'])
    expect(manifest).toEqual([{ providerKey: 'routescan', lists: [{ listKey: 'top-tokens' }] }])
  })

  it('stores a page of tokens under both the global and per-chain lists', async () => {
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [
          buildTokenItem({ address: '0x1111111111111111111111111111111111111a', symbol: 'AAA' }),
          buildTokenItem({ address: '0x2222222222222222222222222222222222222b', symbol: 'BBB' }),
        ],
        count: 2,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    await runCollect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(2)
    // Two lists (global "top-tokens" + chain-specific "top-tokens-ethereum") per token.
    expect(harness.state.listTokens).toHaveLength(4)
    const listKeys = new Set(harness.state.lists.map((list) => list.key))
    expect(listKeys).toEqual(new Set(['top-tokens', 'top-tokens-ethereum']))
  })

  it('backfills missing metadata over RPC when RouteScan omits it', async () => {
    armRowWithGettableSection()
    const address = '0x3333333333333333333333333333333333333c'
    harness.setErc20Metadata(address, ['Backfilled Token', 'BACK', 6])
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [
          {
            ...buildTokenItem({ address }),
            name: '',
            symbol: '',
            decimals: undefined,
          },
        ],
        count: 1,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    await runCollect(new AbortController().signal)

    const stored = [...harness.state.tokens.values()].find((token) => token.providedId === address)
    expect(stored).toMatchObject({ name: 'Backfilled Token', symbol: 'BACK', decimals: 6 })
  })

  it('preserves a zero decimals value from RouteScan when only name/symbol need RPC backfill', async () => {
    // `decimals: 0` is a real, valid value (not "missing"). The backfill branch is only
    // entered here because name/symbol are blank; the ternary that decides whether to
    // keep RouteScan's own decimals or fall through to the RPC-backfilled ones must key
    // off `!== undefined`, not truthiness, or a genuinely zero-decimals token would be
    // silently overwritten by whatever the RPC backfill returned.
    armRowWithGettableSection()
    const address = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    harness.setErc20Metadata(address, ['Backfilled Token', 'BACK', 6])
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [{ ...buildTokenItem({ address }), name: '', symbol: '', decimals: 0 }],
        count: 1,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    await runCollect(new AbortController().signal)

    const stored = [...harness.state.tokens.values()].find((token) => token.providedId === address)
    expect(stored).toMatchObject({ name: 'Backfilled Token', symbol: 'BACK', decimals: 0 })
  })

  it('skips a token whose metadata is missing and cannot be backfilled, without storing it', async () => {
    armRowWithGettableSection()
    const address = '0x4444444444444444444444444444444444444d'
    // Deliberately no `harness.setErc20Metadata(address, ...)` — the RPC backfill rejects.
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [{ ...buildTokenItem({ address }), name: '', symbol: '', decimals: undefined }],
        count: 1,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    await runCollect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(0)
  })

  it('follows pagination until a page comes back empty', async () => {
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [buildTokenItem({ address: '0x5555555555555555555555555555555555555e' })],
        count: 1,
        countType: 'exact',
        link: { next: '/next', nextToken: 'page-2', prev: '', prevToken: '' },
      },
    })
    harness.queueFetchResponse(tokensUrl(1, { nextToken: 'page-2' }), {
      body: { items: [], count: 0, countType: 'exact', link: { next: '', nextToken: '', prev: '', prevToken: '' } },
    })

    await runCollect(new AbortController().signal)

    expect(harness.state.tokens.size).toBe(1)
    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(BLOCKCHAINS_URL, expect.anything())
    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(tokensUrl(1), expect.anything())
    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(tokensUrl(1, { nextToken: 'page-2' }), expect.anything())
  })

  it("recovers from a single chain's processing failure without failing the whole run", async () => {
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), { status: 500, ok: false, statusText: 'Internal Server Error' })

    await expect(runCollect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'chain processing failed %o: %o',
      expect.any(String),
      expect.stringContaining('500'),
    )
  })

  it('skips a blockchain reporting zero RPS, a non-numeric chainId, and an unsupported chainId', async () => {
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, {
      body: {
        items: [
          buildBlockchain({ name: 'Rate limited off', chainId: '2', freeApiRateLimit: { rps: 0, rpd: 0 } }),
          buildBlockchain({ name: 'Not a number', chainId: 'not-a-number' }),
          buildBlockchain({ name: 'Unsupported chain', chainId: '999999' }),
          buildBlockchain(), // chainId 1 (mainnet) — the only queryable one
        ],
      },
    })
    harness.queueFetchResponse(tokensUrl(1), {
      body: { items: [], count: 0, countType: 'exact', link: { next: '', nextToken: '', prev: '', prevToken: '' } },
    })

    await runCollect(new AbortController().signal)

    // Only chain 1's token page was ever requested.
    expect(harness.fetchModule.fetch).toHaveBeenCalledTimes(2)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'unsupported chain %o (%o) from RouteScan',
      999999,
      'Unsupported chain',
    )
  })

  it('throws when RouteScan reports no queryable chains at all', async () => {
    harness.queueFetchResponse(BLOCKCHAINS_URL, {
      body: { items: [buildBlockchain({ freeApiRateLimit: { rps: 0, rpd: 0 } })] },
    })

    await expect(runCollect(new AbortController().signal)).rejects.toThrow(
      'Failed to fetch supported chains from RouteScan API',
    )
  })

  it('propagates and logs a failure fetching the blockchains list itself', async () => {
    harness.queueFetchResponse(BLOCKCHAINS_URL, { status: 503, ok: false, statusText: 'Service Unavailable' })

    await expect(runCollect(new AbortController().signal)).rejects.toThrow(
      'RouteScan blockchains API returned HTTP 503',
    )

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'RouteScan collector failed: %o',
      expect.stringContaining('503'),
    )
  })

  it('rate-limits back-to-back RouteScan calls with a 500ms delay between chains', async () => {
    // `RateLimitedChainProcessor` (module-private) is a module-level singleton whose
    // `lastRequestTime` accumulates across every earlier test in this file, which
    // makes "did the *second* chain wait" unobservable by the time this test runs —
    // by then the gate has already been exercised (or not) by prior tests' chains in
    // ways this test cannot see. `vi.resetModules()` plus a dynamic re-import gets a
    // clean `routescan.ts` module — a fresh `chainProcessor` with `lastRequestTime`
    // still at its initial `0` — so this test can observe the gate in isolation:
    // the first chain must run immediately (no prior request), the second must wait.
    vi.resetModules()
    const freshRoutescan = await import('./routescan')

    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, {
      body: { items: [buildBlockchain(), buildBlockchain({ name: 'Optimism', chainId: '10' })] },
    })
    harness.queueFetchResponse(tokensUrl(1), {
      body: { items: [], count: 0, countType: 'exact', link: { next: '', nextToken: '', prev: '', prevToken: '' } },
    })
    harness.queueFetchResponse(tokensUrl(10), {
      body: { items: [], count: 0, countType: 'exact', link: { next: '', nextToken: '', prev: '', prevToken: '' } },
    })

    const run = freshRoutescan.collect(new AbortController().signal)
    run.catch(() => {})
    await vi.runAllTimersAsync()
    await run

    // Both chains were reached — the second only after `RateLimitedChainProcessor`
    // waited out its 500ms-between-requests gate (flushed instantly by fake timers).
    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(tokensUrl(1), expect.anything())
    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(tokensUrl(10), expect.anything())
  })

  it('abandons a chain whose signal aborts while it is waiting out the rate-limit gate', async () => {
    // Same fresh-module rationale as above: a clean `chainProcessor` with
    // `lastRequestTime` at its initial `0` guarantees this one chain lands on the
    // "wait 500ms" branch, so the abort fires *during* that wait rather than before it.
    vi.resetModules()
    const freshRoutescan = await import('./routescan')

    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    // Deliberately no `tokensUrl(1)` fixture queued — the chain must never get that far.

    const controller = new AbortController()
    const run = freshRoutescan.collect(controller.signal)
    run.catch(() => {})
    // Flush microtasks (provider/list/network inserts, the blockchains fetch) up to
    // the point where `RateLimitedChainProcessor` schedules its 500ms wait, without
    // letting that timer itself fire yet.
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.runAllTimersAsync()
    await run

    // Aborted mid-wait — the token page was never fetched, so nothing was stored.
    expect(harness.state.tokens.size).toBe(0)
    expect(harness.fetchModule.fetch).not.toHaveBeenCalledWith(tokensUrl(1), expect.anything())
  })

  it('skips the rate-limit wait outright when the gate is already satisfied', async () => {
    // Fresh module so `RateLimitedChainProcessor.lastRequestTime` starts at its initial
    // `0`, then advance the fake clock past `minDelayMs` (500ms) before the chain is
    // ever processed. `timeSinceLastRequest` is therefore already >= 500 on the very
    // first check, so `processChain` must skip the `await delay(...)` branch entirely —
    // proven here by resolving without ever needing `vi.runAllTimersAsync()` to flush a
    // pending timer.
    vi.resetModules()
    vi.setSystemTime(10_000)
    const freshRoutescan = await import('./routescan')

    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: { items: [], count: 0, countType: 'exact', link: { next: '', nextToken: '', prev: '', prevToken: '' } },
    })

    await freshRoutescan.collect(new AbortController().signal)

    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(tokensUrl(1), expect.anything())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('signs RouteScan requests with an api key when ROUTESCAN_API_KEY is set', async () => {
    process.env.ROUTESCAN_API_KEY = 'test-api-key'
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1, { apiKey: 'test-api-key' }), {
      body: { items: [], count: 0, countType: 'exact', link: { next: '', nextToken: '', prev: '', prevToken: '' } },
    })

    await runCollect(new AbortController().signal)

    expect(harness.fetchModule.fetch).toHaveBeenCalledWith(tokensUrl(1, { apiKey: 'test-api-key' }), expect.anything())
  })

  it('treats a malformed (non-array items) token page the same as an HTTP failure', async () => {
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), { body: { notItems: true } })

    await expect(runCollect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'chain processing failed %o: %o',
      expect.any(String),
      'Invalid response format from RouteScan API',
    )
  })

  it('treats a malformed (non-array items) blockchains response as a fetch failure', async () => {
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { notItems: true } })

    await expect(runCollect(new AbortController().signal)).rejects.toThrow(
      'Invalid response format from RouteScan blockchains API',
    )
  })

  it("skips only the failing token when a single token's storage throws, without losing its siblings", async () => {
    armRowWithGettableSection()
    const goodAddress = '0x6666666666666666666666666666666666666f'
    const badAddress = '0x7777777777777777777777777777777777777a'
    // `processToken` writes the same token to both the global and chain-specific
    // lists via `Promise.all`; failing every call for `badAddress` (not just the
    // first) keeps the test's claim — this token is skipped entirely — true even
    // though the two `storeToken` calls are otherwise independent writes.
    const originalStoreToken = harness.dbModule.storeToken.getMockImplementation()!
    harness.dbModule.storeToken.mockImplementation(async (input: { token: { providedId: string } }, tx?: unknown) => {
      if (input.token.providedId.toLowerCase() === badAddress) {
        throw new Error('storage exploded')
      }
      return originalStoreToken(input, tx)
    })
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [buildTokenItem({ address: badAddress }), buildTokenItem({ address: goodAddress })],
        count: 2,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    await runCollect(new AbortController().signal)

    // The bad token never landed (its own storeToken call threw); its sibling still did.
    const stored = [...harness.state.tokens.values()].map((token) => token.providedId)
    expect(stored).toContain(goodAddress)
    expect(stored).not.toContain(badAddress)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'token processing failed %o on %o: %o',
      badAddress,
      expect.any(String),
      'storage exploded',
    )
  })

  it('never starts a chain once the signal is already aborted', async () => {
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    const controller = new AbortController()
    controller.abort()

    await runCollect(controller.signal)

    expect(harness.fetchModule.fetch).not.toHaveBeenCalledWith(tokensUrl(1), expect.anything())
    expect(harness.state.tokens.size).toBe(0)
  })

  it('falls back to the 5-second RPC timeout when metadata backfill never resolves', async () => {
    vi.resetModules()
    const freshRoutescan = await import('./routescan')

    armRowWithGettableSection()
    const address = '0x8888888888888888888888888888888888888b'
    // No queued erc20 metadata, and a hung implementation this once — the harness's
    // own "no queued metadata" rejection would resolve too fast to reach the timeout.
    harness.gibsUtilsViemModule.erc20Read.mockImplementationOnce(() => new Promise(() => {}))
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [{ ...buildTokenItem({ address }), name: '', symbol: '', decimals: undefined }],
        count: 1,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    const run = freshRoutescan.collect(new AbortController().signal)
    run.catch(() => {})
    await vi.runAllTimersAsync()
    await run

    expect(harness.state.tokens.size).toBe(0)
  })

  it('abandons a metadata backfill when the signal aborts mid-RPC-race', async () => {
    vi.resetModules()
    const freshRoutescan = await import('./routescan')

    armRowWithGettableSection()
    const address = '0x9999999999999999999999999999999999999c'
    harness.gibsUtilsViemModule.erc20Read.mockImplementationOnce(() => new Promise(() => {}))
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [{ ...buildTokenItem({ address }), name: '', symbol: '', decimals: undefined }],
        count: 1,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    const controller = new AbortController()
    const run = freshRoutescan.collect(controller.signal)
    run.catch(() => {})
    // Flush past the chain-level rate-limit wait (500ms) and into the metadata race
    // (erc20Read called, the race's own abort listener registered) before aborting.
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.runAllTimersAsync()
    await run

    expect(harness.state.tokens.size).toBe(0)
  })

  it('drops every token on a page once the signal aborts between fetching it and processing it', async () => {
    armRowWithGettableSection()
    harness.queueFetchResponse(BLOCKCHAINS_URL, { body: { items: [buildBlockchain()] } })
    harness.queueFetchResponse(tokensUrl(1), {
      body: {
        items: [buildTokenItem({ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })],
        count: 1,
        countType: 'exact',
        link: { next: '', nextToken: '', prev: '', prevToken: '' },
      },
    })

    const controller = new AbortController()
    // Abort right as the token-page fetch resolves — before `processChainTokens`
    // maps over its `items` — so every entry on the page sees an already-aborted
    // signal and is dropped by the `if (signal.aborted || ...) return Promise.resolve(false)`
    // guard, rather than the whole page silently vanishing for some other reason.
    const originalFetch = harness.fetchModule.fetch.getMockImplementation()!
    harness.fetchModule.fetch.mockImplementation(async (url: string | URL, init?: unknown) => {
      const result = await originalFetch(url, init)
      if (url.toString() === tokensUrl(1)) controller.abort()
      return result
    })

    await runCollect(controller.signal)

    expect(harness.state.tokens.size).toBe(0)
  })
})
