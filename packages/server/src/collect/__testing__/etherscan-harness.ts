/**
 * Test harness for `etherscan.ts` — a collector whose two input seams are
 * genuinely outside what `collector-harness.ts` models: it drives a headless
 * browser (`puppeteer` / `puppeteer-core`) to fetch a token table, then
 * parses the resulting hypertext markup with `cheerio` to extract addresses
 * and logo URLs, instead of fetching a JSON token list.
 *
 * What is reused rather than reinvented:
 * - `insertProvider` / `insertList` / `insertNetworkFromChainId` come from a
 *   fresh `createCollectorHarness()` instance, same funnel every other
 *   collector writes through.
 * - `storeToken` / `insertTokenBatch` come from `createTokenStoreHarness()`,
 *   shared with `omnibridge.ts`'s harness.
 * - `cheerio` itself is never mocked — the whole point is exercising the
 *   real markup parser against fixture hypertext-markup-language strings, so
 *   a parsing regression actually fails the test.
 *
 * What is bespoke here:
 * - A fake `puppeteer.Browser`/`Page` pair: `newPage()` returns a page whose
 *   `goto`, `setUserAgent`, `setViewport`, `setExtraHTTPHeaders`, `content`,
 *   and `evaluate` are all individually controllable per test, so a test can
 *   simulate a Cloudflare interstitial, a `goto` failure, or an empty page
 *   without a real browser ever launching (a real launch is structurally
 *   impossible: `puppeteer`/`puppeteer-core` are fully mocked modules).
 * - `fs.promises.mkdir` / `writeFile` are no-ops (etherscan.ts snapshots the
 *   fetched page to disk for debugging; tests never touch the real filesystem).
 * - `fetch` (`../fetch`) is queued per URL, mirroring
 *   `collector-harness.ts`'s `cachedJSONRequest` queueing pattern, for
 *   `fetchEtherscanChainList`'s call to Etherscan's chainlist API.
 * - `limitBy` (`@gibs/utils`) returns an object with a `.map()` method here
 *   (unbounded concurrency, `Promise.all` under the hood) because
 *   `etherscan.ts` uses the real `promise-limit` `.map()` API directly,
 *   unlike the other collectors' `limitBy(key)(items, fn)` call shape that
 *   `collector-harness.ts` models.
 * - `erc20Read` / `createChainClient` (`@gibs/utils/viem`) are queued per
 *   address, same shape as `collector-harness.ts`'s own `erc20Read` mock.
 * - `terminal` is a bespoke fake (not reused from `collector-harness.ts`)
 *   because `etherscan.ts` is the one collector that calls `row.get(key)`
 *   to retrieve a previously `row.issue(key)`-registered section —
 *   `collector-harness.ts`'s fake deliberately always returns `null` from
 *   `get()`, which would make `processChainTokens`'s `row.get(providerKey)!`
 *   throw.
 */
import { vi, type Mock } from 'vitest'
import { createCollectorHarness } from './collector-harness'
import { createTokenStoreHarness } from './token-store-harness'

// ---------------------------------------------------------------------------
// Fake puppeteer Page / Browser
// ---------------------------------------------------------------------------

export type FakePage = {
  setUserAgent: Mock
  setViewport: Mock
  setExtraHTTPHeaders: Mock
  goto: Mock
  evaluate: Mock
  content: Mock
  close: Mock
  /**
   * Queues the fake `document` state the *next* `page.evaluate(callback)` call
   * should see. etherscan.ts's Cloudflare-detection callback is real page-context
   * code (`document.body.innerHTML`/`document.title`) that a real `Page.evaluate`
   * serializes into the browser and runs there — this fake instead runs the exact
   * same callback in the test process against a stubbed global `document`, so the
   * actual string-matching logic gets exercised instead of being replaced by a
   * canned true/false. Unconsumed calls fall back to the most recently queued
   * state (or an empty, non-challenge page if none was ever queued).
   */
  queueDocumentState: (state: { innerHTML?: string; title?: string }) => void
}

/** Builds a fake puppeteer `Page` whose `content()` resolves to `html` and never reports a Cloudflare challenge by default. */
export const createFakePage = (html = '<html><body></body></html>'): FakePage => {
  const documentStates: { innerHTML: string; title: string }[] = []
  let lastDocumentState = { innerHTML: '', title: '' }

  const evaluate = vi.fn(async (callback: () => unknown) => {
    const state = documentStates.shift() ?? lastDocumentState
    lastDocumentState = state
    const globalWithDocument = globalThis as { document?: unknown }
    const previousDocument = globalWithDocument.document
    globalWithDocument.document = { body: { innerHTML: state.innerHTML }, title: state.title }
    try {
      return callback()
    } finally {
      globalWithDocument.document = previousDocument
    }
  })

  return {
    setUserAgent: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    setExtraHTTPHeaders: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    evaluate,
    content: vi.fn(async () => html),
    close: vi.fn(async () => undefined),
    queueDocumentState: (state) => documentStates.push({ innerHTML: state.innerHTML ?? '', title: state.title ?? '' }),
  }
}

export type FakeBrowser = {
  isConnected: Mock
  newPage: Mock
  close: Mock
  disconnect: Mock
}

export const createEtherscanHarness = () => {
  const base = createCollectorHarness()
  const tokenStore = createTokenStoreHarness()

  // -- puppeteer / puppeteer-core -------------------------------------------

  let currentPage: FakePage = createFakePage()
  const newPageError = { current: null as Error | null }

  const browser: FakeBrowser = {
    isConnected: vi.fn(() => true),
    newPage: vi.fn(async () => {
      if (newPageError.current) throw newPageError.current
      return currentPage
    }),
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  }

  const launch = vi.fn(async () => browser)
  const connect = vi.fn(async () => browser)

  const puppeteerModule = { default: { launch }, launch }
  const puppeteerCoreModule = { default: { connect }, connect }

  // -- fs.promises.mkdir / writeFile -----------------------------------------

  const mkdir = vi.fn(async () => undefined)
  const writeFile = vi.fn(async () => undefined)

  // -- ../fetch (Etherscan chainlist API) ------------------------------------

  const fetchResponses = new Map<
    string,
    { ok: boolean; status: number; statusText: string; json: () => unknown } | Error
  >()

  const fetchMock = vi.fn(async (url: string | URL) => {
    const key = url.toString()
    const entry = fetchResponses.get(key)
    if (entry === undefined) {
      throw new Error(`etherscan-harness: no queued fetch response for "${key}" — call harness.queueFetch first.`)
    }
    if (entry instanceof Error) throw entry
    return entry
  })

  // -- @gibs/utils: limitBy / failureLog --------------------------------------

  const failureLog = vi.fn()
  // The real `promise-limit` export is a *callable function* that also carries
  // a `.map` method (see `node_modules/promise-limit/index.js`'s `addExtras`) —
  // etherscan.ts uses both forms (`puppeteerLimiter(fn)` and `chainLimiter.map(...)`),
  // so the fake has to be callable too, not just an object with a `map` key. It
  // also has to genuinely serialize at `count === 1` (both real call sites use
  // count 1): `getSharedBrowser()`'s shared-browser-reuse branch only executes
  // when a second chain's puppeteer call starts *after* the first one already
  // assigned `sharedBrowser` — an unbounded `Promise.all` races both calls
  // through the `!sharedBrowser` check before either assignment lands, which
  // would make that branch structurally unreachable under test even though
  // it fires in production every run with more than one enabled chain.
  const createSemaphore = (count: number) => {
    let outstanding = 0
    const queue: (() => void)[] = []
    const acquire = () =>
      new Promise<void>((resolve) => {
        if (outstanding < count) {
          outstanding += 1
          resolve()
          return
        }
        queue.push(() => {
          outstanding += 1
          resolve()
        })
      })
    const release = () => {
      outstanding -= 1
      const next = queue.shift()
      if (next) next()
    }
    const run = async <T>(fn: () => Promise<T>): Promise<T> => {
      await acquire()
      try {
        return await fn()
      } finally {
        release()
      }
    }
    const limiter = vi.fn(run) as unknown as {
      (fn: () => Promise<unknown>): Promise<unknown>
      map: <T, R>(items: T[], fn: (item: T) => Promise<R>) => Promise<R[]>
    }
    limiter.map = (items, fn) => Promise.all(items.map((item) => run(() => fn(item))))
    return limiter
  }
  const limitBy = vi.fn((_key: string, count = 16) => createSemaphore(count))

  // -- @gibs/utils/viem: erc20Read / createChainClient ------------------------

  type Erc20Entry =
    | readonly [name: string, symbol: string, decimals: number]
    | Error
    | (() => readonly [string, string, number])

  const erc20Metadata = new Map<string, Erc20Entry>()

  const erc20Read = vi.fn(async (_chain: unknown, _client: unknown, address: string) => {
    const entry = erc20Metadata.get(address.toLowerCase())
    if (entry === undefined) {
      throw new Error(`etherscan-harness: no queued erc20 metadata for "${address}".`)
    }
    if (entry instanceof Error) throw entry
    if (typeof entry === 'function') return entry()
    return entry
  })

  const createChainClient = vi.fn((chain: { id: number }) => ({ __fixtureClientForChain: chain.id }))

  // -- ../db --------------------------------------------------------------------

  const imageBatchCalls: {
    listTokenId: string
    uri: string | null
    originalUri: string | null
    providerKey: string
  }[] = []
  const batchFetchImagesFailure = { current: null as Error | null }

  const batchFetchImagesForTokens = vi.fn(
    async (
      items: { listTokenId: string; uri: string | null; originalUri: string | null; providerKey: string }[],
      _tx?: unknown,
    ) => {
      if (batchFetchImagesFailure.current) {
        const error = batchFetchImagesFailure.current
        batchFetchImagesFailure.current = null
        throw error
      }
      imageBatchCalls.push(...items)
      return items.map((item) => ({ ...item, result: item.uri ? { success: true } : null }))
    },
  )

  const dbModule = {
    insertProvider: base.dbModule.insertProvider,
    insertList: base.dbModule.insertList,
    insertNetworkFromChainId: base.dbModule.insertNetworkFromChainId,
    normalizeProvidedId: base.dbModule.normalizeProvidedId,
    insertToken: tokenStore.insertToken,
    insertTokenBatch: tokenStore.insertTokenBatch,
    storeToken: tokenStore.storeToken,
    batchFetchImagesForTokens,
  }

  // -- ../utils: a `terminal` that actually implements row.get(key) -----------

  const makeTaskRow = () => ({
    increment: vi.fn(),
    complete: vi.fn(),
  })

  const makeSection = () => {
    const registered = new Map<string, ReturnType<typeof makeTaskRow>>()
    return {
      task: vi.fn((id: string, _opts?: unknown) => {
        const taskRow = makeTaskRow()
        registered.set(id, taskRow)
        return taskRow
      }),
    }
  }

  const makeRow = () => {
    const sections = new Map<string, ReturnType<typeof makeSection>>()
    return {
      issue: vi.fn((key: string) => {
        const section = makeSection()
        sections.set(key, section)
        return section
      }),
      get: vi.fn((key: string) => sections.get(key) ?? null),
      createCounter: vi.fn(),
      incrementTotal: vi.fn(),
      increment: vi.fn(),
      remove: vi.fn(),
      complete: vi.fn(),
    }
  }

  const terminal = {
    issue: vi.fn(() => makeRow()),
  }

  const counterId = {
    network: (id: number | string) => `${id}`,
    token: ([chainId, address]: [number, string]) => `${chainId}-${address.toLowerCase()}`,
  }

  const utilsModule = { terminal, counterId }

  // -- ../utils/delay -----------------------------------------------------------

  const delayMock = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined)

  const reset = () => {
    base.reset()
    tokenStore.reset()
    currentPage = createFakePage()
    newPageError.current = null
    browser.isConnected.mockReturnValue(true)
    browser.newPage.mockClear()
    browser.close.mockClear()
    browser.disconnect.mockClear()
    launch.mockClear()
    connect.mockClear()
    mkdir.mockClear()
    writeFile.mockClear()
    fetchResponses.clear()
    fetchMock.mockClear()
    failureLog.mockClear()
    limitBy.mockClear()
    erc20Metadata.clear()
    erc20Read.mockClear()
    createChainClient.mockClear()
    imageBatchCalls.length = 0
    batchFetchImagesFailure.current = null
    batchFetchImagesForTokens.mockClear()
    terminal.issue.mockClear()
    delayMock.mockReset()
    delayMock.mockImplementation(async () => undefined)
    delete process.env.BROWSER_WS_ENDPOINT
  }

  return {
    state: {
      providers: base.state.providers,
      lists: base.state.lists,
      networks: base.state.networks,
      tokens: tokenStore.state.tokens,
      listTokens: tokenStore.state.listTokens,
      imageBatchCalls,
    },
    dbModule,
    utilsModule,
    gibsUtilsModule: { failureLog, limitBy },
    gibsUtilsViemModule: { erc20Read, createChainClient },
    puppeteerModule,
    puppeteerCoreModule,
    fsModule: { promises: { mkdir, writeFile } },
    fetchModule: { fetch: fetchMock },
    delayModule: { delay: delayMock },
    browser,
    /** Sets the fake page `browser.newPage()` should return for every subsequent call. */
    setPage: (page: FakePage) => {
      currentPage = page
    },
    /** Makes the next `browser.newPage()` call reject. */
    failNewPage: (error: Error) => {
      newPageError.current = error
    },
    /** Registers the response `fetch(url)` should resolve to for `url` (or an `Error` to reject with). */
    queueFetch: (
      url: string,
      response: { ok: boolean; status?: number; statusText?: string; json: () => unknown } | Error,
    ) => fetchResponses.set(url, response instanceof Error ? response : { status: 200, statusText: 'OK', ...response }),
    /** Registers the `[name, symbol, decimals]` (or an `Error`, or a thunk) an `erc20Read` call should resolve to for `address`. */
    setErc20Metadata: (address: string, entry: Erc20Entry) => erc20Metadata.set(address.toLowerCase(), entry),
    /** Makes the next `batchFetchImagesForTokens` call reject. */
    failNextImageBatch: (error: Error) => {
      batchFetchImagesFailure.current = error
    },
    reset,
  }
}

export type EtherscanHarness = ReturnType<typeof createEtherscanHarness>

/**
 * The instance every `etherscan.ts` test should import and hand to
 * `vi.mock()`. A plain exported singleton, not something built inside
 * `vi.hoisted()` — see `collector-harness.ts`'s doc comment for why.
 */
export const etherscanHarness: EtherscanHarness = createEtherscanHarness()
