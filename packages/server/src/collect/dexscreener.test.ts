import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { harness, createFakeTerminalRowProxy, createFakeTerminalSectionProxy } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('../fetch', () => harness.fetchModule)
vi.mock('@gibs/utils/viem', () => harness.gibsUtilsViemModule)
// `failureLog`/`limitBy` come from the harness; `responseToBuffer` is real and
// dependency-free (pure `Response` -> `Buffer` conversion, no network of its own) —
// dexscreener.ts uses it on top of the mocked `../fetch` response, not instead of it.
vi.mock('@gibs/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gibs/utils')>()),
  failureLog: harness.gibsUtilsModule.failureLog,
  limitBy: harness.gibsUtilsModule.limitBy,
}))
// `dexscreenerApi`'s network-calling functions are replaced with controllable fixtures
// below; `chainIdToChain`/`nameToKey`/every type stay real — they are pure, dependency-free
// data this collector's own chain-matching logic depends on being faithful to production.
//
// Built with `vi.hoisted()`, not a plain top-level `const` — every `vi.mock()` call
// (including the one just below) is hoisted above the *entire* file, plain consts are
// not, so a plain `const dexscreenerApiMock = {...}` referenced from the factory below
// would throw "Cannot access before initialization" the same way described in
// `collector-harness.ts`'s own module doc comment for a *different* hoisting trap.
const dexscreenerApiMock = vi.hoisted(() => ({
  getLatestTokenProfiles: vi.fn(async () => [] as unknown[]),
  getLatestTokenBoosts: vi.fn(async () => [] as unknown[]),
  getTopTokenBoosts: vi.fn(async () => [] as unknown[]),
  tokenPairs: vi.fn(async ({ chainId, tokenAddress }: { chainId: string; tokenAddress: string }) => {
    const fixture = pairsFixtures.get(`${chainId}:${tokenAddress.toLowerCase()}`)
    return fixture ?? []
  }),
}))
vi.mock('@gibs/dexscreener', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gibs/dexscreener')>()),
  dexscreenerApi: dexscreenerApiMock,
}))
// `getTokensUnderListId` is unused by this collector, but the raw
// `getDrizzle().select().from(schema.network).where(and(eq(...), eq(...))).limit(1)`
// bypass (see dexscreener.ts's own comment on why it reaches past `../db`) needs `eq`/`and`
// to stay introspectable, and `../db/drizzle` itself replaced so it never opens a real
// connection pool.
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: (...args: Parameters<(typeof import('drizzle-orm'))['eq']>) => harness.drizzleOrmModule.eq(...args),
  and: (...args: Parameters<(typeof import('drizzle-orm'))['and']>) => harness.drizzleOrmModule.and(...args),
}))
vi.mock('../db/drizzle', () => harness.drizzleModule)

/** `chainId:lowercaseTokenAddress` -> the `TokenPairsResponse` `dexscreenerApi.tokenPairs` should answer with. */
const pairsFixtures = new Map<string, unknown[]>()

beforeEach(() => {
  harness.reset()
  pairsFixtures.clear()
  vi.useFakeTimers({ now: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

import dexscreener, { collect } from './dexscreener'
import { chainIdToChain } from '@gibs/dexscreener'
import * as cheerio from 'cheerio'
import * as fs from 'fs'
import * as path from 'path'

const WPLS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27'

/**
 * The same sidebar-icon set `dexscreener.ts`'s own (unexported) `parseSidebarChainInfo`
 * builds, filtered to the chains `chainIdToChain` actually resolves — exactly the set
 * `collect()` fetches an icon for. Computed once so every test that reaches `collect()`
 * can queue a fixture for each without hand-maintaining a ~90-entry list.
 *
 * Excludes 'ethereum': `runCollect()` below removes it from `chainIdToChain` for the
 * duration of the call (see its own doc comment for why), and that removal means the icon
 * loop's own `chainIdToChain.get(key)` check skips it before ever fetching — a fixture
 * queued for it would just go unconsumed.
 */
const fetchedSidebarIcons = (() => {
  const file = path.join(process.cwd(), 'src', 'harvested', 'dexscreener', 'chain-sidebar.html')
  const html = fs.readFileSync(file, 'utf8')
  const $ = cheerio.load(html)
  const nameToKey = (name: string) => name.toLowerCase().split(' ').join('')
  const icons: { key: string; url: string }[] = []
  $('.ds-nav-link').each((_i, el) => {
    const img = $('img', el)
    const chainName = img.attr('alt')
    const chainImage = img.attr('src')
    if (chainName && chainImage && chainIdToChain.has(nameToKey(chainName)) && nameToKey(chainName) !== 'ethereum') {
      icons.push({ key: nameToKey(chainName), url: chainImage })
    }
  })
  return icons
})()

/**
 * `fetchedSidebarIcons` minus 'tron': `chainIdToChain` resolves it to viem's `tron` chain
 * (id 728126428, no `caip2` override) — a non-Ethereum-Virtual-Machine chain mis-numbered
 * as eip155, which `insertNetworkFromChainId` rejects. Its icon still gets *fetched* (the
 * fetch happens before that check), but the network write that would record it never
 * completes — see the `try`/`catch` around `db.transaction` in `dexscreener.ts`'s icon
 * loop, and its own comment, for the full story of this real, previously-crashing bug
 * this test suite found and fixed.
 */
const storedNetworkIcons = fetchedSidebarIcons.filter(({ key }) => key !== 'tron')

const queueNetworkIconFetches = () => {
  for (const { url } of fetchedSidebarIcons) {
    harness.queueFetchResponse(url, { bodyBuffer: Buffer.from(`fixture-network-icon:${url}`) })
  }
}

/**
 * `Collector.collectDecimals` reads decimals for every token in its current pending
 * batch with one multicall call per batch (always length 1 in these fixtures — one
 * token discovered per `tokenPairs()` response); its bytes32 fallback pass always
 * follows, but resolves on its own once nothing is missing (see the harness's own
 * `multicall` doc comment on the zero-length case). Queue `count` of these — one per
 * round PulseChain's native-token walk makes (1 for just its starting token WPLS, 2 once
 * a pair fixture adds a discovered quote token, etc.).
 */
const queueDecimals = (count: number) => {
  for (let i = 0; i < count; i++) {
    harness.queueMulticallResult([{ status: 'success', result: 18 }])
  }
}

const buildPair = (overrides: Record<string, unknown> = {}) => ({
  chainId: 'pulsechain',
  dexId: 'pulsex',
  url: 'https://dexscreener.com/pulsechain/fixture',
  pairAddress: '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed',
  baseToken: { address: WPLS, name: 'Wrapped Pulse', symbol: 'WPLS' },
  quoteToken: { address: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead', name: 'Fixture Quote', symbol: 'FXQ' },
  priceUsd: '0.0001',
  info: { imageUrl: 'https://dd.dexscreener.com/ds-data/tokens/pulsechain/fixture.png', websites: [], socials: [] },
  ...overrides,
})

/**
 * `TerminalLinkedCollector.tokenPairs` calls `this.row.get(providerKey)!` to find the
 * section `collect()` issued for itself moments earlier, but this harness's fake row
 * proxies do not correlate `.issue()`/`.get()` by id (see `createFakeTerminalSectionProxy`'s
 * doc comment) — arm it explicitly so that resolves to a real section instead of `null`.
 */
const armRowWithGettableSection = () => {
  const row = createFakeTerminalRowProxy()
  const section = createFakeTerminalSectionProxy()
  row.get.mockReturnValue(section)
  harness.utilsModule.terminal.issue.mockReturnValueOnce(row)
}

/**
 * A `collect()` run under fake timers, with every pending timer flushed.
 *
 * PulseChain and Ethereum's native-token walks run concurrently
 * (`Promise.all(relevantChains.map(...))`), and each independently reaches
 * `dexscreener.ts`'s raw `await import('../db/drizzle')` / `await
 * import('drizzle-orm')` bypass (see its own comment on why it reaches past
 * `../db`). Two *simultaneous first-time* dynamic imports of the same bare
 * specifier race Vitest's mock registration under this project's Vite/Vitest
 * version — one resolves to the mock, the other to the real, unmocked module,
 * which then opens a real Postgres connection. Static imports and *sequential*
 * dynamic imports of the same specifier are unaffected; this is specific to
 * two concurrent first accesses. Removing Ethereum from `chainIdToChain` for
 * the duration of the call — restored in `finally` even on failure — leaves
 * PulseChain as the walk's only chain, so the dynamic imports happen once,
 * sequentially, and the mock applies reliably. The code path is identical for
 * every chain `relevantChains` lists, so this does not skip coverage of that
 * path — only of running two chains' walks concurrently, which is exercised
 * for its own sake nowhere else in this file either.
 */
const runCollect = async (signal: AbortSignal) => {
  armRowWithGettableSection()
  const ethereum = chainIdToChain.get('ethereum')
  chainIdToChain.delete('ethereum')
  try {
    const run = collect(signal)
    run.catch(() => {})
    await vi.runAllTimersAsync()
    await run
  } finally {
    if (ethereum) chainIdToChain.set('ethereum', ethereum)
  }
}

describe('dexscreener collector', () => {
  it('registers a provider and its single "api" list during discover()', async () => {
    const manifest = await dexscreener.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['dexscreener'])
    expect(manifest).toEqual([{ providerKey: 'dexscreener', lists: [{ listKey: 'api' }] }])
  })

  it('stores a network icon for every sidebar chain chainIdToChain resolves', async () => {
    queueNetworkIconFetches()
    // No pair data for the native starting token — one decimals round for PulseChain's
    // WPLS, isolating this test to the network-icon phase for its assertions.
    queueDecimals(1)

    await runCollect(new AbortController().signal)

    expect(harness.state.networkImages.length).toBe(storedNetworkIcons.length)
  })

  it('blacklists a chain id reported by the boosted/profile feeds that chainIdToChain does not resolve', async () => {
    queueNetworkIconFetches()
    queueDecimals(1)
    dexscreenerApiMock.getLatestTokenProfiles.mockResolvedValueOnce([{ chainId: 'totally-made-up-chain' } as never])

    await runCollect(new AbortController().signal)

    // The unresolvable chain id never became a network — only the sidebar's own set did.
    expect(harness.state.networkImages.length).toBe(storedNetworkIcons.length)
  })

  it('collects the PulseChain native starting token and its discovered pair into the api list', async () => {
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [buildPair()])
    // Two decimals rounds: PulseChain's WPLS, then the FXQ quote token its one pair discovers.
    queueDecimals(2)

    await runCollect(new AbortController().signal)

    const apiList = harness.state.lists.find((list) => list.key === 'api')!
    const stored = [...harness.state.tokens.values()].map((token) => token.providedId)
    expect(stored).toEqual(expect.arrayContaining([WPLS.toLowerCase(), '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead']))
    expect(harness.state.listTokens.some((lt) => lt.listId === apiList.listId)).toBe(true)
  })

  it("fetches a token's header image once its pair carries one, without blocking its siblings on failure", async () => {
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [
      buildPair({
        info: {
          imageUrl: 'https://dd.dexscreener.com/x.png',
          headerUrl: 'https://dd.dexscreener.com/header.png',
          websites: [],
          socials: [],
        },
      }),
    ])
    queueDecimals(2)
    harness.queueFetchResponse('https://dd.dexscreener.com/header.png', {
      bodyBuffer: Buffer.from('fixture-header-image'),
    })

    await runCollect(new AbortController().signal)

    expect(
      harness.state.tokenHeaders.some((header) => header.originalUri === 'https://dd.dexscreener.com/header.png'),
    ).toBe(true)
  })

  it('does not fail the whole chain when a single token fails to process', async () => {
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [buildPair()])
    queueDecimals(2)
    harness.dbModule.storeToken.mockRejectedValueOnce(new Error('storage exploded'))

    await expect(runCollect(new AbortController().signal)).resolves.toBeUndefined()
  })

  it('the standalone collect() export delegates to the shared collector instance', async () => {
    queueNetworkIconFetches()
    queueDecimals(1)

    await runCollect(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['dexscreener'])
  })

  it('collects chain ids from the latest/top boosted-token feeds, not just profiles', async () => {
    queueNetworkIconFetches()
    queueDecimals(1)
    dexscreenerApiMock.getLatestTokenBoosts.mockResolvedValueOnce([{ chainId: 'pulsechain' } as never])
    dexscreenerApiMock.getTopTokenBoosts.mockResolvedValueOnce([{ chainId: 'pulsechain' } as never])

    await runCollect(new AbortController().signal)

    expect(harness.state.networkImages.length).toBe(storedNetworkIcons.length)
  })

  it('skips a token whose header image fetch throws, logging the failure without losing its logo', async () => {
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [
      buildPair({
        info: {
          imageUrl: 'https://dd.dexscreener.com/x.png',
          headerUrl: 'https://dd.dexscreener.com/broken-header.png',
          websites: [],
          socials: [],
        },
      }),
    ])
    queueDecimals(2)
    harness.dbModule.fetchAndInsertHeader.mockRejectedValueOnce(new Error('header store exploded'))

    await expect(runCollect(new AbortController().signal)).resolves.toBeUndefined()

    // The token itself still made it in — only its header failed, and loudly.
    const stored = [...harness.state.tokens.values()].map((token) => token.providedId)
    expect(stored).toContain(WPLS.toLowerCase())
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'Failed to process token %o: %o',
      WPLS,
      expect.objectContaining({ message: 'header store exploded' }),
    )
  })

  it('skips a chain when its network row cannot be found by the raw lookup', async () => {
    queueNetworkIconFetches()
    // PulseChain's icon still fetches fine, but writing its network row (during the
    // icon phase's `db.transaction`) fails — caught by the same `try`/`catch` the
    // Tron bug fix added, so the icon loop moves on — leaving nothing for the
    // native-token phase's raw `getDrizzle()` lookup (a read, not a write) to find.
    const originalInsertNetworkFromChainId = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
    harness.dbModule.insertNetworkFromChainId.mockImplementation(
      async (chainId: unknown, type?: unknown, tx?: unknown) => {
        if (chainId === 369) throw new Error('pulsechain network insert failed')
        return originalInsertNetworkFromChainId(chainId, type, tx)
      },
    )

    try {
      await runCollect(new AbortController().signal)
    } finally {
      // `mockImplementation` overrides outlive `harness.reset()`'s `vi.clearAllMocks()`
      // (call history only — see the harness's own doc comment on why) — without this,
      // every later test in the file would silently fail to write PulseChain's network
      // row too, whether or not that test's own assertions happened to notice.
      harness.dbModule.insertNetworkFromChainId.mockImplementation(originalInsertNetworkFromChainId)
    }

    expect(harness.state.tokens.size).toBe(0)
  })

  it('stops storing network icons once the signal aborts partway through the batch', async () => {
    queueNetworkIconFetches()
    const controller = new AbortController()
    // Abort as soon as the first icon's network row finishes storing — later entries in
    // the same `limitBy(...).map()` batch must then see an already-aborted signal.
    const originalInsertNetworkFromChainId = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
    let aborted = false
    harness.dbModule.insertNetworkFromChainId.mockImplementation(
      async (chainId: unknown, type?: unknown, tx?: unknown) => {
        const result = await originalInsertNetworkFromChainId(chainId, type, tx)
        if (!aborted) {
          aborted = true
          controller.abort()
        }
        return result
      },
    )

    await expect(runCollect(controller.signal)).resolves.toBeUndefined()

    // Fewer than the full set stored — the batch stopped once the signal aborted.
    expect(harness.state.networkImages.length).toBeLessThan(storedNetworkIcons.length)
  })

  it('stops the native-token walk once the signal aborts between pending-token rounds', async () => {
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [buildPair()])
    const controller = new AbortController()
    // Abort once WPLS's decimals round resolves — the FXQ round the pair discovers must
    // then never run, since the walk's own `while` loop re-checks the signal each round.
    let aborted = false
    const multicall = harness.utilsModule.chainToPublicClient({ id: 369 }).multicall as Mock
    multicall.mockImplementation(async (args: { contracts: unknown[] }) => {
      if (args.contracts.length === 0) return []
      const result = [{ status: 'success', result: 18 }]
      if (!aborted) {
        aborted = true
        controller.abort()
      }
      return result
    })

    await expect(runCollect(controller.signal)).resolves.toBeUndefined()

    expect(harness.state.tokens.size).toBe(0)
  })

  it('stops the native-token walk before starting a second round once the signal is already aborted', async () => {
    // Unlike the test above (whose abort races `collect()`'s own discovery of the
    // second round and, in practice, always wins — the FXQ token this pair discovers
    // never even makes it into the pending queue), this test gates `collectDecimals`'s
    // multicall so `collect()` is guaranteed to finish marking FXQ pending *before* the
    // signal aborts. That proves the walk's own `while` loop re-check — not merely an
    // empty pending queue — is what stops the second round.
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [buildPair()])
    queueDecimals(1)
    const controller = new AbortController()

    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const multicall = harness.utilsModule.chainToPublicClient({ id: 369 }).multicall as Mock
    let gatedOnce = false
    // Reimplements the harness's own default queue-consuming behavior directly (rather
    // than capturing and delegating to `getMockImplementation()`) because a prior test in
    // this file overrides this same mock via `mockImplementation` without restoring it —
    // `mockImplementation` overrides outlive `harness.reset()`'s `vi.clearAllMocks()` (see
    // the harness's own doc comment) — so "whatever is currently installed" is not a safe
    // thing to delegate to here.
    multicall.mockImplementation(async (args: { contracts: unknown[] }) => {
      if (args.contracts.length > 0 && !gatedOnce) {
        gatedOnce = true
        await gate
      }
      if (args.contracts.length === 0) return []
      const queued = harness.state.multicallResults.shift()
      if (!queued) throw new Error('no queued multicall result for this test')
      return queued
    })

    armRowWithGettableSection()
    const ethereum = chainIdToChain.get('ethereum')
    chainIdToChain.delete('ethereum')
    try {
      const run = collect(controller.signal)
      run.catch(() => {})
      // `collect()` depends only on the (ungated) mocked `tokenPairs`, so it finishes —
      // including marking FXQ pending — while `collectDecimals` sits blocked on the gate.
      // Nothing beyond this point *can* progress until the gate releases, so flushing far
      // more microtask ticks than actually needed is safe, not a race.
      for (let i = 0; i < 300; i++) {
        await Promise.resolve()
      }
      controller.abort()
      releaseGate()
      await vi.runAllTimersAsync()
      await run
    } finally {
      if (ethereum) chainIdToChain.set('ethereum', ethereum)
      // `mockImplementation` overrides — unlike call history — survive `harness.reset()`
      // (see the harness's own doc comment on why), so leaving the gate installed would
      // leak into every later test in the file. Put back the harness's own plain
      // queue-consuming behavior (the same shape installed above, minus the gate).
      multicall.mockImplementation(async (args: { contracts: unknown[] }) => {
        if (args.contracts.length === 0) return []
        const queued = harness.state.multicallResults.shift()
        if (!queued) throw new Error('no queued multicall result for this test')
        return queued
      })
    }

    // Only WPLS's round ever reached a decimals lookup — the FXQ round the first round
    // discovered was abandoned by the `while` loop's own abort check before it started.
    const decimalsCalls = multicall.mock.calls.filter((call) => call[0].contracts.length > 0)
    expect(decimalsCalls).toHaveLength(1)
  })

  it('stops storing collected tokens once the signal aborts partway through the list', async () => {
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [buildPair()])
    queueDecimals(2)
    const controller = new AbortController()
    let storeCalls = 0
    const originalStoreToken = harness.dbModule.storeToken.getMockImplementation()!
    harness.dbModule.storeToken.mockImplementation(async (input: unknown, tx?: unknown) => {
      storeCalls += 1
      const result = await originalStoreToken(input, tx)
      // Abort as soon as the first token in the list finishes storing — the for loop's
      // own `if (signal.aborted) break` must then stop before its sibling is reached.
      if (storeCalls === 1) controller.abort()
      return result
    })

    try {
      await expect(runCollect(controller.signal)).resolves.toBeUndefined()
    } finally {
      // See the sibling test above's identical note on why this restore is required.
      harness.dbModule.storeToken.mockImplementation(originalStoreToken)
    }

    // The pair fixture discovers two tokens (WPLS + its quote token) — both land in
    // `state.tokens` via the earlier batch insert, but only the first one processed by
    // the for loop ever got a list association: the second iteration's abort check fired
    // before its own `db.storeToken` call.
    expect(storeCalls).toBe(1)
    const apiList = harness.state.lists.find((list) => list.key === 'api')!
    expect(harness.state.listTokens.filter((lt) => lt.listId === apiList.listId)).toHaveLength(1)
  })

  it("does not double-count a token's image or token record across multiple pairs that share it", async () => {
    // Both pairs share the same base (WPLS) and quote (default fixture) tokens — the
    // second occurrence of each must be recognized as already-seen rather than reprocessed.
    queueNetworkIconFetches()
    pairsFixtures.set(`pulsechain:${WPLS.toLowerCase()}`, [
      buildPair({ pairAddress: '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfee1' }),
      buildPair({ pairAddress: '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfee2' }),
    ])
    queueDecimals(2)

    await runCollect(new AbortController().signal)

    // Both tokens still land in the api list exactly once each, despite each appearing
    // in two pairs — `setToken`/`setInfo`'s own dedup (not the list-storage layer) is
    // what this test is isolating, but the storage-layer's own count is the only
    // outwardly observable proof that dedup happened upstream.
    const stored = [...harness.state.tokens.values()].map((token) => token.providedId)
    expect(stored).toEqual(expect.arrayContaining([WPLS.toLowerCase(), '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead']))
    expect(stored).toHaveLength(2)
  })

  it('falls back to the icon URL itself when the fetched image buffer comes back empty', async () => {
    const brokenIcon = fetchedSidebarIcons[0]!
    for (const { key, url } of fetchedSidebarIcons) {
      if (key === brokenIcon.key) {
        harness.queueFetchResponse(url, { status: 404 })
      } else {
        harness.queueFetchResponse(url, { bodyBuffer: Buffer.from(`fixture-network-icon:${url}`) })
      }
    }
    queueDecimals(1)

    await runCollect(new AbortController().signal)

    // `responseToBuffer` returns null for a non-ok response, so `image ?? url.href`
    // falls through to the icon's own URL string rather than dropping the row.
    const stored = harness.state.networkImages.find((image) => image.uri === brokenIcon.url)
    expect(stored).toBeDefined()
    expect(stored?.uri).toBe(brokenIcon.url)
  })

  it('falls back to the type-wide native starting token when no per-chain-id override exists', async () => {
    // `nativeTokens` keys most chains by `${type}-${id}` (e.g. "evm-369") but also
    // carries a bare-type fallback ("solana") for chains that do not need a per-chain-id
    // override. No real entry in `relevantChains` exercises that fallback today — both
    // PulseChain and Ethereum have their own specific key — so this temporarily points
    // the 'pulsechain' key at a synthetic chain (restored in `finally`) with an id that
    // does not collide with any real `nativeTokens` key, purely to prove the `??` picks
    // up the type-wide entry rather than throwing on a double miss. Its network row is
    // seeded directly (bypassing `insertNetworkFromChainId`'s namespace/type validation,
    // which a bare numeric id paired with a non-Ethereum-Virtual-Machine `type` legitimately
    // fails) so the native-token phase's own raw lookup finds it regardless.
    queueNetworkIconFetches()
    const solanaChain = chainIdToChain.get('solana')!
    const fakeChain = { ...solanaChain, id: 999_999, type: 'solana' as const, caip2: undefined }
    const originalPulsechain = chainIdToChain.get('pulsechain')!
    chainIdToChain.set('pulsechain', fakeChain)
    harness.state.networks.set('eip155-999999', {
      networkId: 'network:eip155-999999',
      type: 'solana',
      chainId: 'eip155-999999',
    })
    const solanaNativeToken = 'So11111111111111111111111111111111111111112'
    pairsFixtures.set(`pulsechain:${solanaNativeToken.toLowerCase()}`, [])
    queueDecimals(1)

    try {
      await runCollect(new AbortController().signal)
    } finally {
      chainIdToChain.set('pulsechain', originalPulsechain)
    }

    expect(dexscreenerApiMock.tokenPairs).toHaveBeenCalledWith(
      expect.objectContaining({ tokenAddress: solanaNativeToken.toLowerCase() }),
    )
  })
})
