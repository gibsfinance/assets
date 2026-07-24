/**
 * Shared test harness for `packages/server/src/collect/*` provider collectors.
 *
 * Every collector in this directory follows the same two-phase shape: fetch a
 * remote list (or synthesize one), normalize its entries, then write a
 * provider/list/network/token graph through `../db` while fetching logo images
 * along the way. This harness stands in for all three of those side effects —
 * the network fetch, the database writes, and the image storage — behind an
 * in-memory model, so a collector test can run its real normalization and
 * insert logic and then assert on what actually reached the "database"
 * instead of re-asserting on a fixture the test itself constructed.
 *
 * ## Usage
 *
 * `vi.mock()` factories are hoisted to the top of the file they are written
 * in and run *lazily* (only once the mocked path is actually imported), so
 * referencing an imported binding from inside one is safe. `vi.hoisted()`
 * callbacks are different: they run *eagerly*, at hoist time, before any of
 * the file's own `import` statements have been evaluated — so a
 * `vi.hoisted(() => createCollectorHarness())` that calls an imported
 * factory throws `Cannot access '<import>' before initialization`. This
 * module sidesteps that trap by exporting one ready-made instance —
 * `harness` — instead of asking each test file to construct its own inside
 * `vi.hoisted()`:
 *
 * ```ts
 * import { describe, it, expect, vi, beforeEach } from 'vitest'
 * import { harness, buildTokenList, buildTokenEntry } from './__testing__/collector-harness'
 *
 * vi.mock('../db', () => harness.dbModule)
 * vi.mock('../utils', () => harness.utilsModule)
 * vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
 *
 * beforeEach(() => {
 *   harness.reset()
 * })
 *
 * // Import the module under test AFTER the mocks are registered above.
 * import * as remoteTokenList from './remote-tokenlist'
 *
 * describe('remote-tokenlist collect', () => {
 *   it('normalizes addresses and drops blacklisted logos', async () => {
 *     harness.queueTokenListResponse('https://example.com/list.json', buildTokenList({
 *       tokens: [buildTokenEntry({ address: '0xABC0000000000000000000000000000000dEaD', chainId: 1 })],
 *     }))
 *
 *     const run = remoteTokenList.collect({
 *       providerKey: 'acme',
 *       listKey: 'default',
 *       tokenList: 'https://example.com/list.json',
 *     })
 *     await run(new AbortController().signal)
 *
 *     expect(harness.state.tokenImages).toHaveLength(1)
 *     expect(harness.state.tokenImages[0]?.token.providedId).toBe('0xabc0000000000000000000000000000000dead')
 *   })
 * })
 * ```
 *
 * `harness` is a plain module-level singleton, not a shared global — Vitest
 * gives each test *file* its own isolated module registry by default, so
 * importing it from two different test files yields two independent
 * instances. Within one file, every test shares it, which is exactly why
 * `reset()` exists.
 *
 * If a test file genuinely needs a second, independent instance in the same
 * file, call `createCollectorHarness()` directly for it (never inside
 * `vi.hoisted()` — see above).
 *
 * ## Why `reset()` is enough — the shared-mock-object gotcha
 *
 * A module-level singleton survives `vi.resetModules()` between tests, which
 * is exactly why call counts and inserted rows can bleed from one test into
 * the next if you are not careful. This harness sidesteps that trap by
 * construction rather than by discipline: every mock function is a single
 * long-lived closure over one mutable `state` object, created once. `reset()`
 * empties `state` (and clears `vi.fn()` call history) instead of re-assigning
 * mock implementations, so there is never a stale implementation left over
 * from a previous test to forget to restore. Call `harness.reset()` from
 * `beforeEach` and nothing else is required.
 *
 * ## What is modeled, and what is deliberately not
 *
 * The `insertProvider` / `insertList` / `insertNetworkFromChainId` mocks
 * replicate the *identity and upsert-conflict* semantics of the real
 * `../db` functions (same row returned for a repeat key, and only the
 * columns the real `onConflictDoUpdate` touches actually change) because
 * that behavior is load-bearing for collectors — see
 * `remote-tokenlist.ts`'s `discover()`, which writes the provider name
 * before delegating to `inmemory-tokenlist.discover()` specifically because
 * the upsert leaves an existing name untouched. Full row shapes (timestamps,
 * every column) are not modeled — collectors never read them.
 *
 * Chain-id validation (`insertNetworkFromChainId` throwing on a mistyped or
 * mis-numbered chain id) is not reimplemented — it delegates to the real,
 * dependency-free helpers in `../../chain-id`, so a collector bug here still
 * throws exactly as it would in production instead of silently passing.
 *
 * Real network access is structurally impossible: nothing in this harness
 * ever calls `fetch`, opens a socket, or touches a real database — every
 * mocked function only reads and writes `state`.
 *
 * A handful of collectors (`pumptires.ts`, `coingecko.ts`, `routescan.ts`,
 * `dexscreener.ts`, `chainlist.ts`) reach past `cachedJSONRequest` — they call
 * `db.cachedJSON` with their own fetcher, or import `../fetch`'s `fetch`
 * directly, and run their own retry/rate-limit loops on top. Two more mocked
 * module shapes exist for exactly that: `fetchModule` (the `../fetch` stand-in
 * — see `queueFetchResponse`) and `dbModule.cachedJSON` (see its own doc
 * comment). Both let the collector's *own* retry/backoff code run for real
 * against a scripted sequence of responses, rather than mocking the retry
 * loop away — that loop, and whether it actually retries and backs off, is
 * usually the point of the test. `gibsUtilsViemModule`, `drizzleOrmModule`,
 * and `drizzleModule` cover the narrower cases of a collector reading on-chain
 * data through `@gibs/utils/viem` directly or a table through `../db/drizzle`
 * directly — see each type's doc comment.
 */
import { vi, type Mock } from 'vitest'
import { keccak256, toBytes } from 'viem'
import {
  toCAIP2,
  fromCAIP2,
  namespaceOf,
  namespaceToNetworkType,
  isFakedEvmReference,
  expectedNetworkType,
  TEST_NETWORK_TYPE,
} from '../../chain-id'
import { normalizeProvidedId as realNormalizeProvidedId } from '../../db/provided-id'
import type { TokenEntry, TokenList } from '../../types'
import type { InsertableList, InsertableProvider, InsertableToken } from '../../db/schema-types'
import type { DrizzleTx } from '../../db/drizzle'
// Real (unmocked) schema table/column objects — used only for identity comparison inside
// the `getTokensUnderListId` / `getDrizzle` stand-ins below, so a collector's real
// `eq(schema.listToken.listId, ...)`-style condition (built against the mocked
// `drizzleOrmModule.eq`, see below) can be matched back to the column it names.
import * as schema from '../../db/schema'

/** A placeholder transaction object handed to callbacks passed to the mocked `db.transaction`. */
const FAKE_TRANSACTION = { __fakeTransaction: true } as unknown as DrizzleTx

// ---------------------------------------------------------------------------
// Recorded state — the simplified in-memory model of what a collector wrote.
// ---------------------------------------------------------------------------

/** A row as `insertProvider` would return it, trimmed to the columns collectors read. */
export type RecordedProvider = {
  providerId: string
  key: string
  name: string | null
  description: string | null
}

/** A row as `insertNetworkFromChainId` would return it. */
export type RecordedNetwork = {
  networkId: string
  type: string
  chainId: string
  /** Set by `setNetworkNaming` — absent until a registry-reading collector (chainlist) writes one. */
  name?: string
  /** Set by `setNetworkNaming` — absent until a registry-reading collector (chainlist) writes one. */
  title?: string
}

/** A row as `insertList` would return it, trimmed to the columns collectors read. */
export type RecordedList = {
  listId: string
  providerId: string
  networkId: string | null
  key: string
  name: string | null
  description: string | null
  default: boolean
  major: number
  minor: number
  patch: number
}

/** One call recorded from `fetchImageAndStoreForToken` — the primary "what did we insert" signal. */
export type RecordedTokenImage = {
  providerKey: string
  listId: string
  listTokenOrderId: number
  uri: string | Buffer | null
  originalUri: string | null
  token: {
    name?: string
    symbol?: string
    decimals?: number
    networkId: string
    providedId: string
  }
}

/** One call recorded from `fetchImageAndStoreForList`. */
export type RecordedListImage = {
  providerKey: string
  listId: string
  uri: string | Buffer | null
  originalUri: string | null
}

/** One call recorded from `fetchImageAndStoreForNetwork`. */
export type RecordedNetworkImage = {
  providerKey: string
  networkId: string
  chainId: string
  uri: string | Buffer | null
  originalUri: string | null
}

/** One call recorded from the bare `fetchImage` fetch-and-return-a-buffer helper. */
export type RecordedImageFetch = {
  providerKey: string | null
  address?: string
  uri: string
}

/** A row as `insertToken`/`insertTokenBatch` would return it, trimmed to the columns collectors read. */
export type RecordedToken = {
  tokenId: string
  networkId: string
  providedId: string
  type: string
  name: string
  symbol: string
  decimals: number
}

/**
 * A row as `insertListToken` (reached through `storeToken`/`insertTokenBatch`
 * callers, e.g. `routescan.ts`, `dexscreener.ts`) would return it.
 */
export type RecordedListToken = {
  listTokenId: string
  listId: string
  tokenId: string
  listTokenOrderId: number
  imageHash: string | null
}

/** One call recorded from `fetchAndInsertHeader` (a per-token header image, distinct from its logo). */
export type RecordedTokenHeader = {
  providerKey: string
  listTokenId: string
  uri: string | Buffer
  originalUri: string
}

/**
 * A fixture queued for the mocked `fetch` — see `queueFetchResponse`'s doc
 * comment for the full contract. Mirrors the handful of `Response` members
 * collectors in this directory actually read.
 */
export type FetchResponseFixture = {
  /** @default 200 */
  status?: number
  /** @default true when `status` is in [200, 300), false otherwise */
  ok?: boolean
  /** @default 'OK' when `ok`, 'Error' otherwise */
  statusText?: string
  /** JSON body returned by `.json()`, and — unless `bodyBuffer` is set — the source `.arrayBuffer()`/`.text()` encode too. */
  body?: unknown
  /** Raw bytes returned by `.arrayBuffer()`/`.text()`, for a collector reading a binary/image response (`responseToBuffer`) rather than JSON. */
  bodyBuffer?: Buffer
}

/**
 * One `client.multicall({ contracts })` result set, positionally matched to the
 * `contracts` array of the call it answers — see `queueMulticallResult`.
 */
export type QueuedMulticallResult = { status: 'success'; result: unknown } | { status: 'failure'; error?: Error }

/** Everything a test can inspect after running a collector against the harness. */
export type CollectorHarnessState = {
  providers: RecordedProvider[]
  lists: RecordedList[]
  networks: Map<string, RecordedNetwork>
  tokenImages: RecordedTokenImage[]
  listImages: RecordedListImage[]
  networkImages: RecordedNetworkImage[]
  imageFetches: RecordedImageFetch[]
  tokenListResponses: Map<string, TokenList | Error>
  erc20Metadata: Map<string, readonly [name: string, symbol: string, decimals: number]>
  failedImageUris: Set<string>
  /** Backs the `db.cachedJSON` stand-in — see its doc comment. */
  jsonCache: Map<string, unknown>
  /** Backs the `../fetch` / `fetch` stand-in — see `queueFetchResponse`'s doc comment. */
  fetchResponses: Map<string, (FetchResponseFixture | Error)[]>
  /** Backs `storeToken`/`insertTokenBatch`, keyed by `${networkId}:${providedId.toLowerCase()}`. */
  tokens: Map<string, RecordedToken>
  /** Backs `storeToken`/`insertTokenBatch`'s list-association half. */
  listTokens: RecordedListToken[]
  /** Backs `fetchAndInsertHeader`. */
  tokenHeaders: RecordedTokenHeader[]
  /** Backs the `client.multicall` stand-in — see `queueMulticallResult`. */
  multicallResults: QueuedMulticallResult[][]
}

const createEmptyState = (): CollectorHarnessState => ({
  providers: [],
  lists: [],
  networks: new Map(),
  tokenImages: [],
  listImages: [],
  networkImages: [],
  imageFetches: [],
  tokenListResponses: new Map(),
  erc20Metadata: new Map(),
  failedImageUris: new Set(),
  jsonCache: new Map(),
  fetchResponses: new Map(),
  tokens: new Map(),
  listTokens: [],
  tokenHeaders: [],
  multicallResults: [],
})

// ---------------------------------------------------------------------------
// Fixture builders — pure, no harness instance required.
// ---------------------------------------------------------------------------

let fixtureCounter = 0

/**
 * Builds a syntactically valid token-list entry, with every field overridable.
 * The generated `address` is a unique, all-lowercase 20-byte hex string — always
 * a valid EVM address per `viem.isAddress`, and already in `normalizeProvidedId`'s
 * canonical (lowercased) form, so most tests do not need to think about EIP-55
 * checksum casing. A test that specifically exercises checksum-casing
 * normalization should pass its own mixed-case, checksum-valid `address` override.
 */
export const buildTokenEntry = (overrides: Partial<TokenEntry> = {}): TokenEntry => {
  fixtureCounter += 1
  const suffix = fixtureCounter.toString(16).padStart(40, '0')
  return {
    chainId: 1,
    address: `0x${suffix}` as TokenEntry['address'],
    name: `Fixture Token ${fixtureCounter}`,
    symbol: `FIX${fixtureCounter}`,
    decimals: 18,
    logoURI: `https://example.com/logo-${fixtureCounter}.png`,
    ...overrides,
  }
}

/** Builds a syntactically valid token list, with every field overridable. */
export const buildTokenList = (overrides: Partial<TokenList> = {}): TokenList => ({
  name: 'Fixture List',
  timestamp: new Date(0).toISOString(),
  version: { major: 1, minor: 0, patch: 0 },
  tokens: [buildTokenEntry()],
  ...overrides,
})

// ---------------------------------------------------------------------------
// Fake terminal (log/App) row + section proxies.
// ---------------------------------------------------------------------------

type SetOrString = Set<string> | string

const asSet = (ids: SetOrString): Set<string> => (typeof ids === 'string' ? new Set([ids]) : ids)

/**
 * A no-op stand-in for `TerminalRowProxy` / `TerminalSectionProxy` (see
 * `../../log/types`). Collectors report progress through these on every
 * token they touch; the harness accepts every call and records nothing,
 * since progress reporting is not part of a collector's observable output.
 */
type FakeTerminalRowProxy = {
  fullId: string
  update: Mock
  createCounter: Mock
  incrementTotal: Mock
  increment: Mock
  decrement: Mock
  removeCounter: Mock
  complete: Mock
  remove: Mock
  hideSection: Mock
  hide: Mock
  issue: Mock
  get: Mock
  hasCounter: Mock
  updateCounter: Mock
}

type FakeTerminalSectionProxy = {
  fullId: string
  get: Mock
  task: Mock
  issue: Mock
  removeRow: Mock
  increment: Mock
  decrement: Mock
  incrementTotal: Mock
  createCounter: Mock
  updateCounter: Mock
}

/**
 * Builds a standalone fake `TerminalRowProxy`. Exported so a test can pass its
 * own row explicitly (e.g. to assert a collector does *not* complete a row it
 * did not create — several collectors skip `row.complete()` when a caller
 * supplies its own row).
 */
export const createFakeTerminalRowProxy = (): FakeTerminalRowProxy => ({
  fullId: 'fake-row',
  update: vi.fn(),
  createCounter: vi.fn(),
  incrementTotal: vi.fn(),
  increment: vi.fn((_key: string, ids: SetOrString) => asSet(ids)),
  decrement: vi.fn((_key: string, ids: SetOrString) => asSet(ids)),
  removeCounter: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
  hideSection: vi.fn(),
  hide: vi.fn(),
  issue: vi.fn(() => createFakeTerminalSectionProxy()),
  get: vi.fn(() => null),
  hasCounter: vi.fn(() => false),
  updateCounter: vi.fn(),
})

/**
 * Builds a standalone fake `TerminalSectionProxy`. Exported so a test covering a
 * collector that retrieves a previously-issued section back out with
 * `row.get(id)` (rather than trusting the return value of `row.issue(id)`, which
 * several collectors — `routescan.ts`, `dexscreener.ts` — discard) can arm that
 * lookup explicitly:
 *
 * ```ts
 * const customRow = createFakeTerminalRowProxy()
 * const customSection = createFakeTerminalSectionProxy()
 * customRow.get.mockReturnValue(customSection)
 * harness.utilsModule.terminal.issue.mockReturnValueOnce(customRow)
 * ```
 */
export const createFakeTerminalSectionProxy = (): FakeTerminalSectionProxy => ({
  fullId: 'fake-section',
  get: vi.fn(() => null),
  task: vi.fn(() => ({ ...createFakeTerminalRowProxy(), unmount: vi.fn() })),
  issue: vi.fn(() => createFakeTerminalRowProxy()),
  removeRow: vi.fn(),
  increment: vi.fn((_key: string, ids: SetOrString) => asSet(ids)),
  decrement: vi.fn((_key: string, ids: SetOrString) => asSet(ids)),
  incrementTotal: vi.fn(),
  createCounter: vi.fn(),
  updateCounter: vi.fn(),
})

// ---------------------------------------------------------------------------
// Module shapes handed to `vi.mock()`.
// ---------------------------------------------------------------------------

/** The subset of `../db`'s exports that `remote-tokenlist.ts` and `inmemory-tokenlist.ts` depend on. */
export type CollectorHarnessDbModule = {
  cachedJSONRequest: Mock
  /** See the doc comment above `cachedJSON`'s implementation for the caching contract this reproduces. */
  cachedJSON: Mock
  normalizeProvidedId: Mock
  insertProvider: Mock
  insertList: Mock
  insertNetworkFromChainId: Mock
  fetchImage: Mock
  fetchImageAndStoreForList: Mock
  fetchImageAndStoreForNetwork: Mock
  fetchImageAndStoreForToken: Mock
  transaction: Mock
  /** See `storeToken`'s doc comment for the identity/upsert semantics this reproduces. */
  storeToken: Mock
  /** The batch counterpart to `storeToken`'s token half only (no list association) — mirrors `insertTokenBatch`. */
  insertTokenBatch: Mock
  fetchAndInsertHeader: Mock
  setNetworkNaming: Mock
  /** A chainable, awaitable stand-in for the real Drizzle query — see its doc comment. */
  getTokensUnderListId: Mock
}

/** The subset of `../utils`'s exports that collectors commonly depend on. */
export type CollectorHarnessUtilsModule = {
  terminal: FakeTerminalSectionProxy
  terminalRow: FakeTerminalRowProxy
  counterId: {
    network: (id: number | string) => string
    token: (pair: [number, string]) => string
  }
  mapToSet: {
    network: <I>(list: I[], fn: (v: I) => number | string) => Set<string>
    token: <I>(list: I[], fn: (v: I) => [number, string]) => Set<string>
  }
  findChain: Mock
  chainToPublicClient: Mock
  removedUndesirable: (names: string[]) => string[]
  chainIdToNetworkId: (chainId: number | string, type?: string) => string
  controller: AbortController
}

/**
 * The concurrency limiter `limitBy(key, count)` returns — the real
 * `promise-limit` value is both directly callable, `limiter(fn)` for a single
 * zero-argument thunk (`routescan.ts`'s `tokenLimiter(() => processToken(...))`),
 * and carries `.map(items, mapper)` (every other current caller) plus a
 * `.queue` length counter. The harness's stand-in mirrors both call shapes —
 * getting the bare-call arity wrong silently breaks with a confusing
 * "items.map is not a function" from *inside* a collector, since the mock
 * would treat the caller's callback as the `items` array.
 */
export type CollectorHarnessLimiter<T> = (<U>(fn: () => Promise<U>) => Promise<U>) & {
  map: <U>(items: readonly T[], mapper: (item: T) => Promise<U>) => Promise<U[]>
  queue: number
}

/** The subset of `@gibs/utils`'s exports that collectors depend on. */
export type CollectorHarnessGibsUtilsModule = {
  failureLog: Mock
  erc20Read: Mock
  limitBy: <T>(_key: string, count?: number) => CollectorHarnessLimiter<T>
}

/**
 * The subset of `@gibs/utils/viem`'s exports that collectors reaching that
 * subpath directly (rather than the re-exported root `@gibs/utils`) depend
 * on — `routescan.ts`, and transitively `@gibs/dexscreener/collector.ts`
 * (`dexscreener.ts`'s `Collector.collectDecimals`). `erc20Read` is the exact
 * same `vi.fn` as `CollectorHarnessGibsUtilsModule.erc20Read`, so
 * `harness.setErc20Metadata` answers a collector regardless of which of the
 * two specifiers it imported `erc20Read` from. `createChainClient` returns
 * the same fixture client (and its `multicall` stand-in — see
 * `queueMulticallResult`) as `utilsModule.chainToPublicClient`.
 */
export type CollectorHarnessGibsUtilsViemModule = {
  erc20Read: Mock
  createChainClient: Mock
}

/**
 * The `../fetch` module's single export. Also usable to stub `globalThis.fetch`
 * for a collector that calls the bare global directly instead of importing the
 * project's IPFS-aware wrapper (`coingecko.ts`) — see `queueFetchResponse`.
 */
export type CollectorHarnessFetchModule = {
  fetch: Mock
}

/**
 * A minimal `drizzle-orm` stand-in for the two collectors (`pumptires.ts`,
 * `dexscreener.ts`) that build a `.where()` condition directly with
 * `eq`/`and`/`desc` instead of going through `../db`'s wrapped functions.
 * Real `eq`/`and` return an opaque Drizzle `SQL` AST node; these return a
 * plain, introspectable `{ column, value }` / `{ and: [...] }` marker instead,
 * which is exactly what `getTokensUnderListId`'s and `drizzleModule`'s
 * `.where()` stand-ins expect. `desc` (used only for `.orderBy()`, whose
 * sort order this harness does not model) is a same-shaped no-op wrapper.
 *
 * A test file wiring this in must preserve every other real `drizzle-orm`
 * export (`sql`, `and`'s siblings, etc.) — `../../db/schema` calls `sql` at
 * import time — so mock it with `importOriginal` rather than a bare replace:
 *
 * ```ts
 * vi.mock('drizzle-orm', async (importOriginal) => ({
 *   ...(await importOriginal<typeof import('drizzle-orm')>()),
 *   ...harness.drizzleOrmModule,
 * }))
 * ```
 */
export type CollectorHarnessDrizzleOrmModule = {
  eq: Mock
  and: Mock
  desc: Mock
}

/**
 * A stand-in for `../db/drizzle`'s `getDrizzle()`, for the one collector
 * (`dexscreener.ts`) that queries a table directly through it instead of
 * going through `../db`'s wrapped functions. Only models
 * `select().from(schema.network).where(eq/and(...)).limit(n)` — the one raw
 * query in this directory — reading from `state.networks`. A collector
 * reaching for a different table through this stand-in gets a clear error
 * naming the gap rather than a silent `undefined`.
 */
export type CollectorHarnessDrizzleModule = {
  getDrizzle: Mock
}

export type CollectorHarness = {
  state: CollectorHarnessState
  dbModule: CollectorHarnessDbModule
  utilsModule: CollectorHarnessUtilsModule
  gibsUtilsModule: CollectorHarnessGibsUtilsModule
  gibsUtilsViemModule: CollectorHarnessGibsUtilsViemModule
  fetchModule: CollectorHarnessFetchModule
  drizzleOrmModule: CollectorHarnessDrizzleOrmModule
  drizzleModule: CollectorHarnessDrizzleModule
  /** Registers the fixture `cachedJSONRequest`/`fetch`-backed collectors should resolve `key` to. Pass an `Error` to make the fetch reject. */
  queueTokenListResponse: (key: string, response: TokenList | Error) => void
  /** Registers the `[name, symbol, decimals]` an on-chain `erc20Read(chain, client, address)` call should resolve to for `address`. */
  setErc20Metadata: (address: string, metadata: readonly [name: string, symbol: string, decimals: number]) => void
  /** Makes the next `fetchImage(uri, ...)` call for this exact `uri` resolve to `null`, as the real function does on a failed fetch. */
  failImageFetch: (uri: string) => void
  /**
   * Registers the fixture the mocked `fetch` (`../fetch`'s export, or
   * `globalThis.fetch` once stubbed with it) should resolve `url.toString()`
   * to, on the *next* call for that exact URL. Call it once per expected
   * call — a collector's own retry loop calling `fetch` the same URL three
   * times needs three calls to `queueFetchResponse`, consumed first-in
   * first-out, so a test can arrange "429, 429, 200" or "network error, 200"
   * sequences to exercise a retry/backoff path. Pass an `Error` to make that
   * call reject outright (a network failure) rather than resolve with a
   * non-ok `Response`.
   *
   * ```ts
   * harness.queueFetchResponse(url, { status: 429 })
   * harness.queueFetchResponse(url, { status: 200, body: { tokens: [...] } })
   * ```
   *
   * A call for a URL with no queued fixture left throws — same "you forgot to
   * arrange this" contract as `queueTokenListResponse`/`setErc20Metadata` —
   * so an unexpectedly-repeated fetch fails the test loudly instead of
   * hanging or silently returning `undefined`.
   */
  queueFetchResponse: (url: string | URL, response: FetchResponseFixture | Error) => void
  /**
   * Registers the next `client.multicall({ contracts })` call's result set
   * (from either `utilsModule.chainToPublicClient` or
   * `gibsUtilsViemModule.createChainClient` — the same fixture client and
   * queue back both), consumed first-in first-out. `results.length` must
   * equal the `contracts.length` of the call it answers, or the stand-in
   * throws — this catches a test whose queued fixture no longer lines up
   * with a collector's call shape after a refactor, rather than returning
   * silently-misaligned results. A call with a *zero-length* `contracts`
   * array skips the queue entirely and resolves to `[]` without needing one
   * queued — its answer is unambiguous, and `@gibs/dexscreener`'s
   * `Collector.collectDecimals` issues exactly such a call (its bytes32
   * fallback pass) whenever nothing was left missing from the first pass.
   */
  queueMulticallResult: (results: QueuedMulticallResult[]) => void
  /** Clears all recorded state and mock call history. Call from `beforeEach`. */
  reset: () => void
}

// ---------------------------------------------------------------------------
// Drizzle condition matching — shared by `getTokensUnderListId` and
// `drizzleModule`'s `getDrizzle()` stand-in, both of which need to interpret
// a `.where()` condition built from the mocked `drizzleOrmModule.eq`/`and`
// (see that type's doc comment for why real `drizzle-orm` `eq`/`and` are not
// usable directly).
// ---------------------------------------------------------------------------

type DrizzleEqCondition = { column: unknown; value: unknown }
type DrizzleAndCondition = { and: DrizzleCondition[] }
type DrizzleCondition = DrizzleEqCondition | DrizzleAndCondition

/** Evaluates a `{ column, value }` / `{ and }` condition against a row, using `resolve` to read the value a given schema column names on that row. */
const matchesDrizzleCondition = (condition: DrizzleCondition, resolve: (column: unknown) => unknown): boolean => {
  if ('and' in condition) return condition.and.every((inner) => matchesDrizzleCondition(inner, resolve))
  return resolve(condition.column) === condition.value
}

/**
 * Builds one harness instance: a mutable `state` object plus the three mocked
 * module shapes that read and write it. See the module doc comment above for
 * the intended `vi.hoisted()` wiring pattern.
 */
export const createCollectorHarness = (): CollectorHarness => {
  const state = createEmptyState()

  // -- ../db -----------------------------------------------------------

  const upsertProvider = (input: InsertableProvider): RecordedProvider => {
    const existing = state.providers.find((provider) => provider.key === input.key)
    if (existing) {
      // Mirrors the real `onConflictDoUpdate` set clause on the provider table,
      // which only ever reassigns `providerId` (a no-op) — name/description from
      // a later call are deliberately ignored so the first write wins.
      return existing
    }
    const created: RecordedProvider = {
      providerId: `provider:${input.key}`,
      key: input.key,
      name: input.name ?? null,
      description: input.description ?? null,
    }
    state.providers.push(created)
    return created
  }

  const insertProvider = vi.fn(async (provider: InsertableProvider | InsertableProvider[], _tx?: DrizzleTx) => {
    const items = Array.isArray(provider) ? provider : [provider]
    return items.map(upsertProvider)
  })

  const listIdentity = (input: InsertableList): string =>
    `${input.providerId}:${input.key ?? 'default'}:${input.major ?? 0}:${input.minor ?? 0}:${input.patch ?? 0}`

  const upsertList = (input: InsertableList): RecordedList => {
    const listId = `list:${listIdentity(input)}`
    const existing = state.lists.find((list) => list.listId === listId)
    if (existing) {
      // Mirrors the real `onConflictDoUpdate` set clause on the list table: listId,
      // providerId, key, major, minor, patch, and default are refreshed; name,
      // description, and networkId are deliberately left as the first write set them.
      existing.providerId = input.providerId
      existing.key = input.key ?? 'default'
      existing.major = input.major ?? 0
      existing.minor = input.minor ?? 0
      existing.patch = input.patch ?? 0
      existing.default = input.default ?? false
      return existing
    }
    const created: RecordedList = {
      listId,
      providerId: input.providerId,
      networkId: input.networkId ?? null,
      key: input.key ?? 'default',
      name: input.name ?? null,
      description: input.description ?? null,
      default: input.default ?? false,
      major: input.major ?? 0,
      minor: input.minor ?? 0,
      patch: input.patch ?? 0,
    }
    state.lists.push(created)
    return created
  }

  const insertList = vi.fn(async (list: InsertableList, _tx?: DrizzleTx) => [upsertList(list)])

  const insertNetworkFromChainId = vi.fn(async (chainId: number | string, type = 'evm', _tx?: DrizzleTx) => {
    const canonicalChainId = toCAIP2(chainId.toString())
    if (isFakedEvmReference(canonicalChainId)) {
      throw new Error(
        `chain id "${canonicalChainId}" is a non-Ethereum-Virtual-Machine chain mis-numbered as eip155; collect it under its coin-type id (Solana -> solana-501, Tron -> tvm-195) instead.`,
      )
    }
    const expectedType = expectedNetworkType(canonicalChainId)
    if (type !== expectedType && type !== TEST_NETWORK_TYPE) {
      throw new Error(
        `network type "${type}" conflicts with chain id "${canonicalChainId}": its namespace requires type "${expectedType}".`,
      )
    }
    const existing = state.networks.get(canonicalChainId)
    if (existing) {
      // Mirrors the real conflict clause on the network table: only networkId is
      // reassigned (a no-op) — type/chainId stay as the first write set them.
      return existing
    }
    const created: RecordedNetwork = { networkId: `network:${canonicalChainId}`, type, chainId: canonicalChainId }
    state.networks.set(canonicalChainId, created)
    return created
  })

  const fetchImage = vi.fn(
    async (
      url: string | Buffer,
      _signal: AbortSignal | null | undefined,
      providerKey: string | null = null,
      address?: string,
    ) => {
      if (Buffer.isBuffer(url)) return url
      if (!url) return null
      if (state.failedImageUris.has(url)) return null
      state.imageFetches.push({ uri: url, providerKey, address })
      return Buffer.from(`fixture-image:${url}`)
    },
  )

  const fetchImageAndStoreForList = vi.fn(
    async (
      input: { listId: string; uri: string | Buffer | null; originalUri: string | null; providerKey: string },
      _tx?: DrizzleTx,
    ) => {
      if (!input.uri || !input.originalUri) return { list: state.lists.find((list) => list.listId === input.listId) }
      state.listImages.push({
        providerKey: input.providerKey,
        listId: input.listId,
        uri: input.uri,
        originalUri: input.originalUri,
      })
      return { list: state.lists.find((list) => list.listId === input.listId) }
    },
  )

  const fetchImageAndStoreForNetwork = vi.fn(
    async (
      input: {
        network: RecordedNetwork
        uri: string | Buffer
        originalUri: string
        providerKey: string
      },
      _tx?: DrizzleTx,
    ) => {
      if (!input.uri) return undefined
      state.networkImages.push({
        providerKey: input.providerKey,
        networkId: input.network.networkId,
        chainId: input.network.chainId,
        uri: input.uri,
        originalUri: input.originalUri,
      })
      return { network: input.network }
    },
  )

  const fetchImageAndStoreForToken = vi.fn(
    async (
      input: {
        listId: string
        listTokenOrderId: number
        uri: string | Buffer | null
        originalUri: string | null
        token: InsertableToken
        providerKey: string
      },
      _tx?: DrizzleTx,
    ) => {
      state.tokenImages.push({
        providerKey: input.providerKey,
        listId: input.listId,
        listTokenOrderId: input.listTokenOrderId,
        uri: input.uri,
        originalUri: input.originalUri,
        token: {
          name: input.token.name ?? undefined,
          symbol: input.token.symbol ?? undefined,
          decimals: input.token.decimals ?? undefined,
          networkId: input.token.networkId,
          providedId: input.token.providedId,
        },
      })
      return undefined
    },
  )

  const cachedJSONRequest = vi.fn(async (key: string, _signal: AbortSignal) => {
    const entry = state.tokenListResponses.get(key)
    if (entry === undefined) {
      throw new Error(
        `collector-harness: no queued token list response for "${key}" — call harness.queueTokenListResponse(url, tokenList) before invoking the collector under test.`,
      )
    }
    if (entry instanceof Error) throw entry
    return entry
  })

  /**
   * Reproduces the real `db.cachedJSON`'s cache-hit/validate contract against
   * `state.jsonCache` (a plain in-memory map, not a fake clock — no TTL
   * expiry is modeled, since nothing in this directory's tests should assert
   * on wall-clock timing) rather than a queued fixture: `fn` — the
   * collector's own fetcher, itself calling the mocked `fetch` — genuinely
   * runs on a cache miss, so a collector's retry/backoff loop inside `fn`
   * executes for real and is exercised by the test, not skipped by the mock.
   * A `validate` that rejects a cached value (e.g. a previously-cached
   * rate-limit error body) falls through to a real re-fetch, exactly as the
   * real function does.
   */
  const cachedJSON = vi.fn(
    async <T>(
      key: string,
      signal: AbortSignal,
      fn: (signal: AbortSignal) => Promise<T>,
      options: { ttl?: number; validate?: (result: unknown) => boolean } = {},
    ): Promise<T> => {
      if (state.jsonCache.has(key)) {
        const cached = state.jsonCache.get(key) as T
        if (!options.validate || options.validate(cached)) return cached
      }
      const result = await fn(signal)
      if (!options.validate || options.validate(result)) {
        state.jsonCache.set(key, result)
      }
      return result
    },
  )

  const transaction = vi.fn(async <T>(fn: (tx: DrizzleTx) => Promise<T>) => fn(FAKE_TRANSACTION))

  const tokenKey = (networkId: string, providedId: string) => `${networkId}:${realNormalizeProvidedId(providedId)}`

  const upsertToken = (input: InsertableToken): RecordedToken => {
    const key = tokenKey(input.networkId, input.providedId)
    const existing = state.tokens.get(key)
    if (existing) {
      // Mirrors the real `onConflictDoUpdate` set clause on the token table, which
      // only ever reassigns `tokenId` (a no-op) — name/symbol/decimals from a later
      // call are deliberately ignored, same "first write wins" rule as insertProvider/insertList above.
      return existing
    }
    const created: RecordedToken = {
      tokenId: `token:${key}`,
      networkId: input.networkId,
      providedId: realNormalizeProvidedId(input.providedId),
      type: input.type ?? 'erc20',
      name: input.name.split('\x00').join(''),
      symbol: input.symbol.split('\x00').join(''),
      decimals: input.decimals ?? 0,
    }
    state.tokens.set(key, created)
    return created
  }

  const upsertListToken = ({
    tokenId,
    listId,
    imageHash,
    listTokenOrderId,
  }: {
    tokenId: string
    listId: string
    imageHash?: string
    listTokenOrderId: number
  }): RecordedListToken => {
    const listTokenId = `listToken:${tokenId}:${listId}`
    const existing = state.listTokens.find((listToken) => listToken.listTokenId === listTokenId)
    if (existing) {
      // Mirrors the real `onConflictDoUpdate` set clause on the listToken table: a
      // repeat (token, list) write refreshes `listTokenOrderId` unconditionally, and
      // `imageHash` only when this write actually supplied one (COALESCE) — a fresh
      // collect run that fetched no image must not blank out a previously-fetched one.
      existing.listTokenOrderId = listTokenOrderId
      existing.imageHash = imageHash ?? existing.imageHash
      return existing
    }
    const created: RecordedListToken = { listTokenId, listId, tokenId, listTokenOrderId, imageHash: imageHash ?? null }
    state.listTokens.push(created)
    return created
  }

  /** Mirrors real `storeToken`: insert/upsert the token, then its (listId, token) association — no image logic. */
  const storeToken = vi.fn(
    async (
      {
        token,
        listId,
        imageHash,
        listTokenOrderId,
      }: { token: InsertableToken; listId: string; imageHash?: string; listTokenOrderId: number },
      _tx?: DrizzleTx,
    ) => {
      const insertedToken = upsertToken(token)
      const listToken = upsertListToken({ tokenId: insertedToken.tokenId, listId, imageHash, listTokenOrderId })
      return { token: insertedToken, listToken }
    },
  )

  /** Mirrors real `insertTokenBatch`: the token half of `storeToken` only, batched — no list association. */
  const insertTokenBatch = vi.fn(async (tokens: InsertableToken[], _tx?: DrizzleTx) => tokens.map(upsertToken))

  const fetchAndInsertHeader = vi.fn(
    async (
      header: {
        providerKey: string
        listTokenId: string
        uri: string | Buffer
        originalUri: string
        signal?: AbortSignal
        maxImageAge?: number
      },
      _tx?: DrizzleTx,
    ) => {
      state.tokenHeaders.push({
        providerKey: header.providerKey,
        listTokenId: header.listTokenId,
        uri: header.uri,
        originalUri: header.originalUri,
      })
      return undefined
    },
  )

  const setNetworkNaming = vi.fn(
    async (
      { networkId, name, title }: { networkId: string; name?: string | null; title?: string | null },
      _tx?: DrizzleTx,
    ) => {
      const network = [...state.networks.values()].find((candidate) => candidate.networkId === networkId)
      if (!network) return
      // Mirrors the real function's per-field skip-blank semantics: a blank/whitespace
      // value means "nothing to write" and leaves any existing name/title untouched,
      // rather than clearing it.
      const trimmedName = name?.trim()
      const trimmedTitle = title?.trim()
      if (trimmedName) network.name = trimmedName
      if (trimmedTitle) network.title = trimmedTitle
    },
  )

  type ListTokenJoinRow = {
    listId: string
    chainId: string
    providedId: string
    decimals: number
    symbol: string
    name: string
    tokenId: string
    imageHash: string | null
    ext: string | null
    mode: string | null
    uri: string | null
    providerKey: string
    listKey: string
  }

  /**
   * Builds the `getTokensUnderListId()` join purely off `fetchImageAndStoreForToken`
   * calls — the only write path the one current caller (`pumptires.ts`) uses. A
   * future caller writing through `storeToken`/`insertTokenBatch` instead would
   * need this extended to also read `state.listTokens`/`state.tokens` — left out
   * for now so this join only claims to model what is actually exercised.
   */
  const buildListTokenJoinRows = (): ListTokenJoinRow[] =>
    state.tokenImages.map((image) => {
      const list = state.lists.find((candidate) => candidate.listId === image.listId)
      const provider = list && state.providers.find((candidate) => candidate.providerId === list.providerId)
      const network = [...state.networks.values()].find((candidate) => candidate.networkId === image.token.networkId)
      return {
        listId: image.listId,
        chainId: network?.chainId ?? '',
        providedId: image.token.providedId,
        decimals: image.token.decimals ?? 0,
        symbol: image.token.symbol ?? '',
        name: image.token.name ?? '',
        tokenId: `token:${image.token.networkId}:${image.token.providedId}`,
        imageHash: image.uri ? `image:${String(image.uri)}` : null,
        ext: null,
        mode: null,
        uri: typeof image.uri === 'string' ? image.uri : null,
        providerKey: provider?.key ?? image.providerKey,
        listKey: list?.key ?? '',
      }
    })

  const resolveListTokenField = (row: ListTokenJoinRow, column: unknown): unknown => {
    if (column === schema.listToken.listId) return row.listId
    return undefined
  }

  /**
   * A chainable, awaitable stand-in for the real `getTokensUnderListId()` Drizzle
   * query. Supports both shapes `pumptires.ts` uses:
   * `await getTokensUnderListId().where(eq(schema.listToken.listId, someListId))`
   * and the same with a trailing `.orderBy(desc(...))` — sort order is not
   * modeled, only row membership. Requires the test file to also mock
   * `drizzle-orm`'s `eq`/`desc` with `drizzleOrmModule` (see its doc comment)
   * so the `.where()` condition stays introspectable instead of an opaque
   * real Drizzle SQL node.
   */
  const getTokensUnderListId = vi.fn(() => {
    let condition: DrizzleCondition | null = null
    const resolveRows = (): ListTokenJoinRow[] => {
      const rows = buildListTokenJoinRows()
      if (!condition) return rows
      return rows.filter((row) =>
        matchesDrizzleCondition(condition as DrizzleCondition, (column) => resolveListTokenField(row, column)),
      )
    }
    const builder = {
      where: vi.fn((nextCondition: DrizzleCondition) => {
        condition = nextCondition
        return builder
      }),
      orderBy: vi.fn(() => resolveRows()),
      then: (onFulfilled: (rows: ListTokenJoinRow[]) => unknown, onRejected?: (error: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(onFulfilled, onRejected),
    }
    return builder
  })

  const dbModule: CollectorHarnessDbModule = {
    cachedJSONRequest,
    cachedJSON,
    normalizeProvidedId: vi.fn(realNormalizeProvidedId),
    insertProvider,
    insertList,
    insertNetworkFromChainId,
    fetchImage,
    fetchImageAndStoreForList,
    fetchImageAndStoreForNetwork,
    fetchImageAndStoreForToken,
    transaction,
    storeToken,
    insertTokenBatch,
    fetchAndInsertHeader,
    setNetworkNaming,
    getTokensUnderListId,
  }

  // -- ../utils ----------------------------------------------------------

  const findChain = vi.fn((chainId: number) => ({ id: chainId, name: `fixture-chain-${chainId}` }))

  /**
   * Answers `client.multicall({ contracts })` for both `utilsModule.chainToPublicClient`
   * and `gibsUtilsViemModule.createChainClient`'s fixture clients — one shared queue
   * regardless of which of the two a collector built its client through.
   */
  const multicall = vi.fn(async ({ contracts }: { contracts: unknown[] }) => {
    // A zero-length `contracts` array has one unambiguous answer — no fixture needed
    // to say what it is. `@gibs/dexscreener`'s `Collector.collectDecimals` always issues
    // a second (bytes32-fallback) multicall for whichever tokens failed the first
    // pass, even when that set is empty, so this is not a hypothetical case.
    if (contracts.length === 0) return []
    const queued = state.multicallResults.shift()
    if (!queued) {
      throw new Error(
        'collector-harness: no queued multicall result — call harness.queueMulticallResult(results) before invoking the collector under test.',
      )
    }
    if (queued.length !== contracts.length) {
      throw new Error(
        `collector-harness: queued multicall result has ${queued.length} entries but the call requested ${contracts.length} — check that queueMulticallResult(...) lines up with the contracts array it answers.`,
      )
    }
    return queued
  })

  const createFixturePublicClient = (chainId: number) => ({ __fixtureClientForChain: chainId, multicall })

  const chainToPublicClient = vi.fn((chain: { id: number }) => createFixturePublicClient(chain.id))

  const utilsModule: CollectorHarnessUtilsModule = {
    terminal: createFakeTerminalSectionProxy(),
    terminalRow: createFakeTerminalRowProxy(),
    counterId: {
      network: (id: number | string) => `${id}`,
      token: ([chainId, address]: [number, string]) => `${chainId}-${address.toLowerCase()}`,
    },
    mapToSet: {
      network: <I>(list: I[], fn: (v: I) => number | string) => new Set(list.map(fn).map((id) => `${id}`)),
      token: <I>(list: I[], fn: (v: I) => [number, string]) =>
        new Set(list.map(fn).map(([chainId, address]) => `${chainId}-${address.toLowerCase()}`)),
    },
    findChain,
    chainToPublicClient,
    removedUndesirable: (names: string[]) => names.filter((name) => name !== '.DS_Store'),
    // Pure re-derivation of the real `chainIdToNetworkId` (a keccak256 hash of
    // type+reference) — safe to compute directly rather than mock, and doing so
    // means a list's networkId in `state.lists` matches what the real network
    // row's networkId would be for the same chain id.
    chainIdToNetworkId: (chainId: number | string, type?: string) => {
      const canonical = toCAIP2(String(chainId))
      const reference = fromCAIP2(canonical)
      const resolvedType = type ?? namespaceToNetworkType(namespaceOf(canonical))
      return keccak256(toBytes(`${resolvedType}${reference}`)).slice(2)
    },
    controller: new AbortController(),
  }

  // -- @gibs/utils ---------------------------------------------------------

  const erc20Read = vi.fn(async (_chain: unknown, _client: unknown, address: string) => {
    const metadata = state.erc20Metadata.get(address.toLowerCase())
    if (!metadata) {
      throw new Error(
        `collector-harness: no queued erc20 metadata for "${address}" — call harness.setErc20Metadata(address, [name, symbol, decimals]) before invoking the collector under test.`,
      )
    }
    return metadata
  })

  /**
   * Mirrors real `promise-limit`'s own concurrency semantics (see
   * `node_modules/promise-limit/index.js`) rather than the simpler "run
   * everything at once" a fake could get away with for most fixtures: a job
   * beyond `count` is queued, not started, and only dequeued from inside the
   * `.then()` of an earlier job's completion — a genuine asynchronous gap in
   * which an `AbortSignal` can flip between an earlier item's per-item guard
   * and a later, still-queued one's. A collector whose batch never exceeds
   * `count` (nearly every fixture in this directory) never notices the
   * difference; `pumptires.test.ts`'s over-the-limit tests rely on it.
   */
  const createLimiter = <T>(count: number): CollectorHarnessLimiter<T> => {
    type Job = { run: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }
    let outstanding = 0
    const jobs: Job[] = []

    const dispatch = (job: Job) => {
      outstanding += 1
      job.run().then(
        (result) => {
          settle()
          job.resolve(result)
        },
        (error) => {
          settle()
          job.reject(error)
        },
      )
    }

    const settle = () => {
      outstanding -= 1
      if (outstanding >= count) return
      const job = jobs.shift()
      limiter.queue = jobs.length
      if (job) dispatch(job)
    }

    const schedule = <U>(run: () => Promise<U>): Promise<U> =>
      new Promise<U>((resolve, reject) => {
        const job = { run, resolve, reject } as Job
        if (outstanding < count) {
          dispatch(job)
        } else {
          jobs.push(job)
          limiter.queue = jobs.length
        }
      })

    const limiter = Object.assign(<U>(fn: () => Promise<U>) => schedule(fn), {
      queue: 0,
      map: async <U>(items: readonly T[], mapper: (item: T) => Promise<U>): Promise<U[]> => {
        let failed = false
        return Promise.all(
          items.map((item) =>
            schedule(async () => {
              if (failed) return undefined as U
              try {
                return await mapper(item)
              } catch (error) {
                failed = true
                throw error
              }
            }),
          ),
        )
      },
    }) as CollectorHarnessLimiter<T>

    return limiter
  }

  const gibsUtilsModule: CollectorHarnessGibsUtilsModule = {
    failureLog: vi.fn(),
    erc20Read,
    limitBy: <T>(_key: string, count = 16) => createLimiter<T>(count),
  }

  // -- @gibs/utils/viem ------------------------------------------------------

  const gibsUtilsViemModule: CollectorHarnessGibsUtilsViemModule = {
    erc20Read,
    createChainClient: vi.fn((chain: { id: number }) => createFixturePublicClient(chain.id)),
  }

  // -- ../fetch (and, once stubbed onto globalThis, bare `fetch`) ------------

  const fetchQueueKey = (url: string | URL): string => url.toString()

  const fetchStandIn = vi.fn(async (url: string | URL, _init?: { signal?: AbortSignal | null }) => {
    const key = fetchQueueKey(url)
    const next = state.fetchResponses.get(key)?.shift()
    if (!next) {
      throw new Error(
        `collector-harness: no queued fetch response for "${key}" — call harness.queueFetchResponse(url, response) before invoking the collector under test.`,
      )
    }
    if (next instanceof Error) throw next
    const status = next.status ?? 200
    const ok = next.ok ?? (status >= 200 && status < 300)
    const textBody = () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? null))
    return {
      ok,
      status,
      statusText: next.statusText ?? (ok ? 'OK' : 'Error'),
      json: async () => next.body,
      text: async () => textBody(),
      arrayBuffer: async () => next.bodyBuffer ?? Buffer.from(textBody()),
    }
  })

  const fetchModule: CollectorHarnessFetchModule = { fetch: fetchStandIn }

  // -- drizzle-orm / ../db/drizzle --------------------------------------------

  const drizzleOrmModule: CollectorHarnessDrizzleOrmModule = {
    eq: vi.fn((column: unknown, value: unknown): DrizzleEqCondition => ({ column, value })),
    and: vi.fn((...conditions: DrizzleCondition[]): DrizzleAndCondition => ({ and: conditions })),
    desc: vi.fn((column: unknown) => ({ desc: column })),
  }

  const resolveNetworkField = (network: RecordedNetwork, column: unknown): unknown => {
    if (column === schema.network.type) return network.type
    if (column === schema.network.chainId) return network.chainId
    if (column === schema.network.networkId) return network.networkId
    return undefined
  }

  const getDrizzle = vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table !== schema.network) {
          throw new Error(
            'collector-harness: the getDrizzle() stand-in only models the network table — extend collector-harness.ts to support this raw query.',
          )
        }
        let condition: DrizzleCondition | null = null
        const builder = {
          where: vi.fn((nextCondition: DrizzleCondition) => {
            condition = nextCondition
            return builder
          }),
          limit: vi.fn(async (count: number) => {
            const rows = [...state.networks.values()].filter(
              (network) =>
                !condition ||
                matchesDrizzleCondition(condition as DrizzleCondition, (column) =>
                  resolveNetworkField(network, column),
                ),
            )
            return rows.slice(0, count)
          }),
        }
        return builder
      }),
    })),
  }))

  const drizzleModule: CollectorHarnessDrizzleModule = { getDrizzle }

  const reset = () => {
    state.providers.length = 0
    state.lists.length = 0
    state.networks.clear()
    state.tokenImages.length = 0
    state.listImages.length = 0
    state.networkImages.length = 0
    state.imageFetches.length = 0
    state.tokenListResponses.clear()
    state.erc20Metadata.clear()
    state.failedImageUris.clear()
    state.jsonCache.clear()
    state.fetchResponses.clear()
    state.tokens.clear()
    state.listTokens.length = 0
    state.tokenHeaders.length = 0
    state.multicallResults.length = 0
    vi.clearAllMocks()
  }

  return {
    state,
    dbModule,
    utilsModule,
    gibsUtilsModule,
    gibsUtilsViemModule,
    fetchModule,
    drizzleOrmModule,
    drizzleModule,
    queueTokenListResponse: (key, response) => state.tokenListResponses.set(key, response),
    setErc20Metadata: (address, metadata) => state.erc20Metadata.set(address.toLowerCase(), metadata),
    failImageFetch: (uri) => state.failedImageUris.add(uri),
    queueFetchResponse: (url, response) => {
      const key = fetchQueueKey(url)
      const queue = state.fetchResponses.get(key) ?? []
      queue.push(response)
      state.fetchResponses.set(key, queue)
    },
    queueMulticallResult: (results) => {
      state.multicallResults.push(results)
    },
    reset,
  }
}

/**
 * The instance every collector test file should import and hand to
 * `vi.mock()`. See the module doc comment for why this is a plain exported
 * singleton rather than something built inside `vi.hoisted()`.
 */
export const harness: CollectorHarness = createCollectorHarness()
