import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('../fetch', () => harness.fetchModule)
// pumptires.ts calls `retry` (its own retrieveData retry loop, and the class-level
// `collect()` wrapper) for real — only `failureLog`/`limitBy` come from the harness.
vi.mock('@gibs/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gibs/utils')>()),
  failureLog: harness.gibsUtilsModule.failureLog,
  limitBy: harness.gibsUtilsModule.limitBy,
}))
// `getTokensUnderListId`'s `.where(eq(schema.listToken.listId, ...))` needs `eq`/`desc`
// to stay introspectable (see `drizzleOrmModule`'s doc comment) — `sql` and everything
// else must stay real, since `../db/schema` calls `sql` at import time.
//
// `harness` itself is referenced only inside these two closures — never at the
// factory's own top level — because `collector-harness.ts` imports `../../db/schema`,
// which imports `drizzle-orm`: that transitive import reaches this factory *before*
// `harness`'s own `import { harness } from './__testing__/collector-harness'` binding
// below has finished initializing, so touching `harness` any earlier than "inside a
// function called later" throws "Cannot access 'harness' before initialization".
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (...args: Parameters<(typeof import('drizzle-orm'))['eq']>) => harness.drizzleOrmModule.eq(...args),
  desc: (...args: Parameters<(typeof import('drizzle-orm'))['desc']>) => harness.drizzleOrmModule.desc(...args),
}))

beforeEach(() => {
  harness.reset()
  vi.useFakeTimers({ now: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

import pumptires, { collect, collectAttempt } from './pumptires'

const API_BASE = 'https://api2.pump.tires/api/tokens'

const pumpUrl = (filter: 'created_timestamp' | 'launch_timestamp', cursor?: string) => {
  const url = new URL(API_BASE)
  url.searchParams.set('filter', filter)
  url.searchParams.set('direction', 'next')
  if (cursor) url.searchParams.set('cursor', cursor)
  return url.toString()
}

type FixturePumpToken = {
  address: string
  name: string
  symbol: string
  image_cid: string
  description: string
  price: string
  price_5m_ago: string
  price_ath: string
  price_atl: string
  tokens_sold: string
  total_supply: string
  market_value: string
  total_volume_usd: string
  reserve_token: string | null
  reserve_wpls: string | null
  locked_lp: string | null
  lp_total_supply: string | null
  created_timestamp: number
  latest_activity_timestamp: number
  is_launched: boolean
  launch_timestamp: number
  pair_address: string | null
  creator_address: string
  creator_username: string
  creator_avatar_cid: string
}

const buildPumpToken = (overrides: Partial<FixturePumpToken> = {}): FixturePumpToken => ({
  address: '0x111111111111111111111111111111111111111a',
  name: 'Fixture Pump Token',
  symbol: 'FPT',
  image_cid: 'bafyfixtureimage',
  description: 'a fixture token',
  price: '0.001',
  price_5m_ago: '0.001',
  price_ath: '0.002',
  price_atl: '0.0005',
  tokens_sold: '1000',
  total_supply: '1000000000',
  market_value: '1000',
  total_volume_usd: '10000',
  reserve_token: null,
  reserve_wpls: null,
  locked_lp: null,
  lp_total_supply: null,
  created_timestamp: 1,
  latest_activity_timestamp: 1,
  is_launched: true,
  launch_timestamp: 1,
  pair_address: null,
  creator_address: '0xcccccccccccccccccccccccccccccccccccccc',
  creator_username: 'fixture',
  creator_avatar_cid: 'bafyavatar',
  ...overrides,
})

const emptyPage = { hasMore: false, limit: 100, nextCursor: null, prevCursor: null, tokens: [] }

/** A `collect()`/`collectAttempt()` run under fake timers, with every pending timer flushed. */
const runCollect = async (run: Promise<void>) => {
  run.catch(() => {})
  await vi.runAllTimersAsync()
  await run
}

describe('pumptires collector', () => {
  it('registers a provider and its three list keys during discover()', async () => {
    const manifest = await pumptires.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['pumptires'])
    expect(manifest).toEqual([
      { providerKey: 'pumptires', lists: [{ listKey: 'tokens' }, { listKey: 'launched' }, { listKey: 'highcap' }] },
    ])
  })

  it('collects created and launched tokens from a single page each', async () => {
    harness.queueFetchResponse(pumpUrl('created_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address: '0x111111111111111111111111111111111111111a', symbol: 'CREATED' })],
      },
    })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address: '0x222222222222222222222222222222222222222b', symbol: 'LAUNCHED' })],
      },
    })
    // The launched token is re-read via `getTokensUnderListId` for the highcap pass —
    // give it reserves comfortably below the 1-billion-PLS highcap threshold.
    harness.queueMulticallResult([
      { status: 'success', result: [1n, 1n, 0] },
      { status: 'success', result: [1n, 1n, 0] },
    ])

    await runCollect(collectAttempt(new AbortController().signal))

    const createdList = harness.state.lists.find((list) => list.key === 'tokens')!
    const launchedList = harness.state.lists.find((list) => list.key === 'launched')!
    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!

    const createdImage = harness.state.tokenImages.find((image) => image.listId === createdList.listId)
    const launchedImage = harness.state.tokenImages.find((image) => image.listId === launchedList.listId)
    expect(createdImage?.uri).toBe('https://ipfs-pump-tires.b-cdn.net/ipfs/bafyfixtureimage')
    expect(createdImage?.token.providedId).toBe('0x111111111111111111111111111111111111111a')
    expect(launchedImage?.token.providedId).toBe('0x222222222222222222222222222222222222222b')

    // Below the highcap threshold — never promoted to the highcap list.
    expect(harness.state.tokenImages.some((image) => image.listId === highcapList.listId)).toBe(false)
  })

  it('promotes a launched token to the highcap list once its pooled WPLS reserve crosses one billion', async () => {
    const address = '0x333333333333333333333333333333333333333c'
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address, symbol: 'HIGHCAP' })],
      },
    })
    // Both reserve slots comfortably above the 1-billion-PLS threshold regardless of
    // which side `getReserves` resolves as the WPLS leg.
    const bigReserve = 2_000_000_000n * 10n ** 18n
    harness.queueMulticallResult([
      { status: 'success', result: [bigReserve, bigReserve, 0] },
      { status: 'success', result: [bigReserve, bigReserve, 0] },
    ])

    await runCollect(collectAttempt(new AbortController().signal))

    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!
    const highcapImage = harness.state.tokenImages.find((image) => image.listId === highcapList.listId)
    expect(highcapImage?.token.providedId).toBe(address)
  })

  it("skips a token pair's contribution when its multicall reads fail, without crashing the run", async () => {
    const address = '0x444444444444444444444444444444444444444d'
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address })],
      },
    })
    harness.queueMulticallResult([
      { status: 'failure', error: new Error('reverted') },
      { status: 'failure', error: new Error('reverted') },
    ])

    await runCollect(collectAttempt(new AbortController().signal))

    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!
    expect(harness.state.tokenImages.some((image) => image.listId === highcapList.listId)).toBe(false)
  })

  it('stops paginating once a known (already-collected) token reappears on a page', async () => {
    // Seed a "known" launched token directly through `discover()` + `state.tokenImages`
    // rather than an initial `collectAttempt()` run — `db.cachedJSON` caches each page
    // by its (filter, cursor) key with no signal to distinguish "a fixture from an
    // earlier collectAttempt() call in this test" from "a fixture for this one", so a
    // second run against the same un-cursored URL would silently replay the first
    // run's (empty) page instead of the one just queued for it.
    await pumptires.discover(new AbortController().signal)
    const launchedList = harness.state.lists.find((list) => list.key === 'launched')!
    const knownAddress = '0x111111111111111111111111111111111111111a'
    harness.state.tokenImages.push({
      providerKey: 'pumptires',
      listId: launchedList.listId,
      listTokenOrderId: 0,
      uri: 'https://ipfs-pump-tires.b-cdn.net/ipfs/already-known',
      originalUri: 'https://ipfs-pump-tires.b-cdn.net/ipfs/already-known',
      token: { networkId: launchedList.networkId!, providedId: knownAddress },
    })

    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: {
        hasMore: true,
        limit: 100,
        nextCursor: 'cursor-2',
        prevCursor: null,
        tokens: [
          buildPumpToken({ address: '0x555555555555555555555555555555555555555e', symbol: 'NEW' }),
          buildPumpToken({ address: knownAddress, symbol: 'KNOWN' }),
        ],
      },
    })
    // A second page is deliberately not queued — hitting the known token must stop
    // pagination before a second request is ever made.
    // The highcap pass re-reads the *whole* launched list (the pre-seeded "known" row
    // above plus the newly-collected one), so it needs one queued multicall result per row.
    harness.queueMulticallResult([
      { status: 'success', result: [1n, 1n, 0] },
      { status: 'success', result: [1n, 1n, 0] },
    ])
    harness.queueMulticallResult([
      { status: 'success', result: [1n, 1n, 0] },
      { status: 'success', result: [1n, 1n, 0] },
    ])

    await runCollect(collectAttempt(new AbortController().signal))

    // Only the two single fixture pages were fetched — no second (cursor-2) page.
    expect(harness.fetchModule.fetch).toHaveBeenCalledTimes(2)
    const newTokenImage = harness.state.tokenImages.find(
      (image) => image.token.providedId === '0x555555555555555555555555555555555555555e',
    )
    expect(newTokenImage).toBeDefined()
  })

  it('retries a page fetch that fails once and recovers, without losing the token', async () => {
    harness.queueFetchResponse(pumpUrl('created_timestamp'), new Error('network blip'))
    harness.queueFetchResponse(pumpUrl('created_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address: '0x666666666666666666666666666666666666666f' })],
      },
    })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    await runCollect(collectAttempt(new AbortController().signal))

    const createdImage = harness.state.tokenImages.find(
      (image) => image.token.providedId === '0x666666666666666666666666666666666666666f',
    )
    expect(createdImage).toBeDefined()
    // Both the failed and the recovering call hit the same URL (a `URL` instance,
    // not a string — `pumptires.ts` builds it via `new URL(API_BASE)`).
    const createdCalls = harness.fetchModule.fetch.mock.calls.filter(
      (call) => call[0].toString() === pumpUrl('created_timestamp'),
    )
    expect(createdCalls.length).toBe(2)
  })

  it('rejects a page whose response is missing a tokens array, after exhausting its retries', async () => {
    for (let i = 0; i < 5; i++) {
      harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: { hasMore: false } })
    }
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    await expect(runCollect(collectAttempt(new AbortController().signal))).rejects.toThrow(
      'unexpected response: missing tokens array',
    )
  })

  it('collect() retries the whole attempt on failure and gives up after its configured attempts', async () => {
    // `mockRejectedValueOnce` x3 (not a blanket `mockRejectedValue`) so the override is
    // fully consumed by this test's exactly-3 attempts and cannot leak a permanent
    // rejection into whichever test runs next — `harness.reset()`'s `vi.clearAllMocks()`
    // clears call history but deliberately does not undo a standing implementation
    // override (see the harness's own module doc comment on why).
    harness.dbModule.insertProvider.mockRejectedValueOnce(new Error('database unavailable'))
    harness.dbModule.insertProvider.mockRejectedValueOnce(new Error('database unavailable'))
    harness.dbModule.insertProvider.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(runCollect(collect(new AbortController().signal))).rejects.toThrow('database unavailable')

    // `collect()` wraps `collectAttempt()` in `retry({ attempts: 3 })` — three tries total.
    expect(harness.dbModule.insertProvider).toHaveBeenCalledTimes(3)
  })

  it('recovers within collect() when only the first attempt fails', async () => {
    harness.dbModule.insertProvider.mockRejectedValueOnce(new Error('transient'))
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    await runCollect(collect(new AbortController().signal))

    expect(harness.dbModule.insertProvider).toHaveBeenCalledTimes(2)
  })

  it('stops walking a page as soon as the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()

    await runCollect(collectAttempt(controller.signal))

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('walks a second page using the cursor the first page returned', async () => {
    harness.queueFetchResponse(pumpUrl('created_timestamp'), {
      body: {
        hasMore: true,
        limit: 100,
        nextCursor: 'created-cursor-2',
        prevCursor: null,
        tokens: [buildPumpToken({ address: '0x777777777777777777777777777777777777777a', symbol: 'PAGE1' })],
      },
    })
    harness.queueFetchResponse(pumpUrl('created_timestamp', 'created-cursor-2'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address: '0x888888888888888888888888888888888888888b', symbol: 'PAGE2' })],
      },
    })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    await runCollect(collectAttempt(new AbortController().signal))

    const createdAddresses = harness.state.tokenImages
      .filter((image) => image.token.symbol === 'PAGE1' || image.token.symbol === 'PAGE2')
      .map((image) => image.token.providedId)
    expect(createdAddresses).toEqual(
      expect.arrayContaining([
        '0x777777777777777777777777777777777777777a',
        '0x888888888888888888888888888888888888888b',
      ]),
    )
  })

  it('retries a page whose body fails to parse as JSON, then recovers', async () => {
    const goodPage = {
      hasMore: false,
      limit: 100,
      nextCursor: null,
      prevCursor: null,
      tokens: [buildPumpToken({ address: '0x999999999999999999999999999999999999999c' })],
    }
    let call = 0
    const originalFetch = harness.fetchModule.fetch.getMockImplementation()!
    harness.fetchModule.fetch.mockImplementation(async (url: string | URL, init?: unknown) => {
      if (url.toString() !== pumpUrl('created_timestamp')) return originalFetch(url, init)
      call += 1
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => {
            throw new Error('unexpected token in JSON')
          },
          text: async () => 'not json',
          arrayBuffer: async () => Buffer.from('not json'),
        }
      }
      return originalFetch(url, init)
    })
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: goodPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    await runCollect(collectAttempt(new AbortController().signal))

    const recovered = harness.state.tokenImages.find(
      (image) => image.token.providedId === '0x999999999999999999999999999999999999999c',
    )
    expect(recovered).toBeDefined()
  })

  it('falls back to an empty reserve pair when a highcap multicall read never resolves and the signal aborts', async () => {
    const address = `0x${'c'.repeat(40)}`
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address })],
      },
    })
    // A client built for any chain id shares the same fixture `multicall` — hang the
    // very next call (`getReserves`'s) so the race can only resolve via the abort
    // listener (lines 440-441) rather than a real result.
    const fixtureClient = harness.utilsModule.chainToPublicClient({ id: 369 })
    ;(
      fixtureClient.multicall as unknown as { mockImplementationOnce: (impl: () => Promise<never>) => void }
    ).mockImplementationOnce(() => new Promise(() => {}))

    const controller = new AbortController()
    const run = collectAttempt(controller.signal)
    run.catch(() => {})
    // Flush up to (but not through) the 15-second multicall timeout, then abort.
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.runAllTimersAsync()
    await run

    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!
    expect(harness.state.tokenImages.some((image) => image.listId === highcapList.listId)).toBe(false)
  })

  it('promotes a launched token using the WPLS-side reserve when WPLS sorts first in the pair', async () => {
    // `getReserves`/`tokenToPair` order the pair lexicographically — every other test in
    // this file uses an address that sorts *after* WPLS, so `rt1` always happens to be
    // the WPLS leg and the `getAddress(token0) === getAddress(wpls) ? rt0 : rt1` ternary's
    // other branch (`rt0`) never runs. This address sorts *before* WPLS instead, and the
    // two reserve slots are deliberately asymmetric — picking the wrong one would put this
    // token on the wrong side of the one-billion-PLS highcap threshold entirely.
    const address = `0xb${'0'.repeat(39)}`
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address, symbol: 'ORDER' })],
      },
    })
    const wplsSideReserve = 2_000_000_000n * 10n ** 18n // above threshold
    const tokenSideReserve = 1n // far below threshold
    harness.queueMulticallResult([
      { status: 'success', result: [wplsSideReserve, tokenSideReserve, 0] },
      { status: 'success', result: [wplsSideReserve, tokenSideReserve, 0] },
    ])

    await runCollect(collectAttempt(new AbortController().signal))

    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!
    const highcapImage = harness.state.tokenImages.find((image) => image.listId === highcapList.listId)
    expect(highcapImage?.token.providedId).toBe(address)
  })

  it('stops collecting a filter once the signal aborts between fetching a page and processing it', async () => {
    const address = `0xd${'0'.repeat(39)}`
    const controller = new AbortController()
    const originalFetch = harness.fetchModule.fetch.getMockImplementation()!
    harness.fetchModule.fetch.mockImplementation(async (url: string | URL, init?: unknown) => {
      const response = await originalFetch(url, init)
      // Abort once the created-timestamp page itself has resolved but before
      // `collectTokens`'s post-await check runs — proving that check (not merely an
      // already-aborted signal at the top of the loop) is what stops processing.
      if (url.toString() === pumpUrl('created_timestamp')) controller.abort()
      return response
    })
    harness.queueFetchResponse(pumpUrl('created_timestamp'), {
      body: {
        hasMore: false,
        limit: 100,
        nextCursor: null,
        prevCursor: null,
        tokens: [buildPumpToken({ address })],
      },
    })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    try {
      await runCollect(collectAttempt(controller.signal))
    } finally {
      harness.fetchModule.fetch.mockImplementation(originalFetch)
    }

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('drops the token past the concurrency limit once the signal aborts mid-batch (created list)', async () => {
    // `limitTokens` caps concurrency at 16, so with 17 tokens the first 16 all start
    // (and, here, block) synchronously while the 17th is queued behind the limiter —
    // only dequeued once one of the first 16 completes, a genuine asynchronous gap in
    // which the signal can (and here does) abort before the 17th's own check runs.
    const tokens = Array.from({ length: 17 }, (_, i) =>
      buildPumpToken({ address: `0x1${i.toString(16).padStart(39, '0')}`, symbol: `CR${i}` }),
    )
    harness.queueFetchResponse(pumpUrl('created_timestamp'), {
      body: { hasMore: false, limit: 100, nextCursor: null, prevCursor: null, tokens },
    })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    const controller = new AbortController()
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
      const run = collectAttempt(controller.signal)
      run.catch(() => {})
      // Every item within the concurrency limit (16) starts and blocks on the gate before
      // any of them can complete — nothing beyond that point *can* progress until the gate
      // releases, so flushing more microtask ticks than strictly needed is safe, not a race.
      let iterations = 0
      while (gatedCalls < 16 && iterations < 2000) {
        await Promise.resolve()
        iterations += 1
      }
      expect(gatedCalls).toBe(16)
      controller.abort()
      releaseGate()
      await vi.runAllTimersAsync()
      await run
    } finally {
      harness.dbModule.fetchImageAndStoreForToken.mockImplementation(originalStore)
    }

    const createdList = harness.state.lists.find((list) => list.key === 'tokens')!
    const stored = harness.state.tokenImages.filter((image) => image.listId === createdList.listId)
    expect(stored).toHaveLength(16)
    // The 17th token's own `if (signal.aborted) return` fired before it ever called
    // `fetchImageAndStoreForToken` at all.
    expect(gatedCalls).toBe(16)
  })

  it('drops the launched token past the concurrency limit once the signal aborts mid-batch, halting the highcap read pass too', async () => {
    const tokens = Array.from({ length: 17 }, (_, i) =>
      buildPumpToken({ address: `0x2${i.toString(16).padStart(39, '0')}`, symbol: `LN${i}` }),
    )
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), {
      body: { hasMore: false, limit: 100, nextCursor: null, prevCursor: null, tokens },
    })

    const controller = new AbortController()
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
      const run = collectAttempt(controller.signal)
      run.catch(() => {})
      let iterations = 0
      while (gatedCalls < 16 && iterations < 2000) {
        await Promise.resolve()
        iterations += 1
      }
      expect(gatedCalls).toBe(16)
      controller.abort()
      releaseGate()
      await vi.runAllTimersAsync()
      await run
    } finally {
      harness.dbModule.fetchImageAndStoreForToken.mockImplementation(originalStore)
    }

    const launchedList = harness.state.lists.find((list) => list.key === 'launched')!
    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!
    const storedLaunched = harness.state.tokenImages.filter((image) => image.listId === launchedList.listId)
    expect(storedLaunched).toHaveLength(16)
    // The highcap read pass runs over every *known* launched token — all 16 that made it
    // in. By the time it starts the signal is already aborted (set during the launched
    // batch above), so none of the 16 ever reach a multicall call; no fixture was queued
    // for any of them, so a stray call here would fail loudly rather than silently pass.
    expect(harness.state.tokenImages.some((image) => image.listId === highcapList.listId)).toBe(false)
  })

  it('drops the highcap insert past the concurrency limit once the signal aborts mid-batch', async () => {
    await pumptires.discover(new AbortController().signal)
    const launchedList = harness.state.lists.find((list) => list.key === 'launched')!
    const addresses = Array.from({ length: 17 }, (_, i) => `0x3${i.toString(16).padStart(39, '0')}`)
    for (const address of addresses) {
      harness.state.tokenImages.push({
        providerKey: 'pumptires',
        listId: launchedList.listId,
        listTokenOrderId: 0,
        uri: `https://ipfs-pump-tires.b-cdn.net/ipfs/${address}`,
        originalUri: `https://ipfs-pump-tires.b-cdn.net/ipfs/${address}`,
        token: { networkId: launchedList.networkId!, providedId: address },
      })
      const bigReserve = 2_000_000_000n * 10n ** 18n
      harness.queueMulticallResult([
        { status: 'success', result: [bigReserve, bigReserve, 0] },
        { status: 'success', result: [bigReserve, bigReserve, 0] },
      ])
    }
    harness.queueFetchResponse(pumpUrl('created_timestamp'), { body: emptyPage })
    harness.queueFetchResponse(pumpUrl('launch_timestamp'), { body: emptyPage })

    const controller = new AbortController()
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
      const run = collectAttempt(controller.signal)
      run.catch(() => {})
      // Nothing calls `fetchImageAndStoreForToken` until every one of the 17 highcap
      // candidates has finished its (ungated) multicall read and been sorted — this loop
      // therefore also proves that whole read pass completed with the signal still clear.
      let iterations = 0
      while (gatedCalls < 16 && iterations < 5000) {
        await Promise.resolve()
        iterations += 1
      }
      expect(gatedCalls).toBe(16)
      controller.abort()
      releaseGate()
      await vi.runAllTimersAsync()
      await run
    } finally {
      harness.dbModule.fetchImageAndStoreForToken.mockImplementation(originalStore)
    }

    const highcapList = harness.state.lists.find((list) => list.key === 'highcap')!
    const stored = harness.state.tokenImages.filter((image) => image.listId === highcapList.listId)
    expect(stored).toHaveLength(16)
  })
})
