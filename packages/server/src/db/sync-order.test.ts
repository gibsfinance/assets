import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import type { DiscoveryManifest } from '../collect/base-collector'

// ---------------------------------------------------------------------------
// Mocks
//
// sync-order reaches the database through `getDrizzle()` and the `db` barrel.
// Both are replaced so the ordering logic can be exercised without Postgres —
// the rankings themselves are pure, and the sync path is about *which* writes
// happen in *which* order, which the mocks record faithfully.
// ---------------------------------------------------------------------------
const { drizzleState, dbMock } = vi.hoisted(() => ({
  drizzleState: {
    /** Rows returned by any select chain in the current test. */
    rows: [] as unknown[],
    /** Every delete(...).where(...) issued, so cleanup can be asserted. */
    deletes: [] as unknown[],
  },
  dbMock: {
    insertProvider: vi.fn(),
    insertOrder: vi.fn(),
    ids: { provider: vi.fn((key: string) => `provider-id:${key}`) },
  },
}))

/**
 * Minimal drizzle query-builder stand-in: every chain method returns itself and
 * the object is awaitable, so both `.where(...)` and `.where(...).limit(1)`
 * resolve to the configured rows.
 */
const makeChain = () => {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.from = vi.fn(self)
  chain.leftJoin = vi.fn(self)
  chain.innerJoin = vi.fn(self)
  chain.where = vi.fn(self)
  chain.limit = vi.fn(() => Promise.resolve(drizzleState.rows))
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(drizzleState.rows).then(resolve, reject)
  return chain
}

const makeDrizzle = () => {
  const handle = {
    select: vi.fn(() => makeChain()),
    delete: vi.fn(() => ({
      where: vi.fn((condition: unknown) => {
        drizzleState.deletes.push(condition)
        return Promise.resolve()
      }),
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(handle)),
  }
  return handle
}

vi.mock('./drizzle', () => ({ getDrizzle: vi.fn(() => makeDrizzle()) }))
vi.mock('.', () => dbMock)

/** Fresh module instance — sync-order keeps the cached order id at module scope. */
const loadSyncOrder = async () => {
  vi.resetModules()
  return import('./sync-order')
}

// Load the module graph once, outside any test's budget — see the note in
// chains.test.ts. `loadSyncOrder` runs inside each test, so without this the
// first caller absorbs the whole transform-and-load cost.
beforeAll(async () => {
  await import('./sync-order').catch(() => {})
}, 60_000)

const manifestOf = (entries: Record<string, string[]>): DiscoveryManifest =>
  Object.entries(entries).map(([providerKey, listKeys]) => ({
    providerKey,
    lists: listKeys.map((listKey) => ({ listKey })),
  }))

beforeEach(() => {
  drizzleState.rows = []
  drizzleState.deletes = []
  // The mock object is shared across module reloads, so call history has to be
  // dropped explicitly or counts bleed from one test into the next.
  vi.clearAllMocks()
  dbMock.insertProvider.mockResolvedValue([{ providerId: 'gibs-provider-id' }])
  dbMock.insertOrder.mockResolvedValue({ order: { listOrderId: '0xorder' } })
  dbMock.ids.provider.mockImplementation((key: string) => `provider-id:${key}`)
})

// ---------------------------------------------------------------------------
// computeRankings — the pure ordering rule behind image priority
// ---------------------------------------------------------------------------

describe('computeRankings', () => {
  it('spaces providers by position * 1000 so each owns a numbering tier', async () => {
    const { computeRankings } = await loadSyncOrder()
    const rankings = computeRankings(
      ['dexscreener', 'trustwallet', 'coingecko'],
      new Map([
        ['dexscreener', manifestOf({ dexscreener: ['api'] })],
        ['trustwallet', manifestOf({ trustwallet: ['wallet'] })],
        ['coingecko', manifestOf({ coingecko: ['ethereum'] })],
      ]),
    )

    // The gap is what lets `ranking / 1000` recover the provider tier in the
    // dense_rank CTE, so the spacing is the contract — not just the order.
    expect(rankings.map((entry) => entry.ranking)).toEqual([0, 1000, 2000])
  })

  it('orders a provider sub-lists alphabetically within its tier', async () => {
    const { computeRankings } = await loadSyncOrder()
    const rankings = computeRankings(
      ['trustwallet'],
      new Map([['trustwallet', manifestOf({ trustwallet: ['wallet-pulsechain', 'wallet-ethereum', 'wallet'] })]]),
    )

    // Deterministic ordering matters: collection discovers lists in arbitrary
    // order, and an unstable sort would reshuffle image priority run to run.
    expect(rankings.map((entry) => [entry.listKey, entry.ranking])).toEqual([
      ['wallet', 0],
      ['wallet-ethereum', 1],
      ['wallet-pulsechain', 2],
    ])
  })

  it('sub-ranks dynamic providers inside their parent tier', async () => {
    const { computeRankings } = await loadSyncOrder()
    const rankings = computeRankings(
      ['uniswap-tokenlists'],
      new Map([['uniswap-tokenlists', manifestOf({ 'uniswap-compound': ['hosted'], 'uniswap-aave': ['hosted'] })]]),
    )

    // One collectable fans out to many providers; they share the parent tier
    // rather than each consuming a 1000-wide slot of their own.
    expect(rankings.map((entry) => [entry.providerKey, entry.ranking])).toEqual([
      ['uniswap-aave', 0],
      ['uniswap-compound', 1],
    ])
  })

  it('keeps positional spacing when a collectable discovered nothing', async () => {
    const { computeRankings } = await loadSyncOrder()
    const rankings = computeRankings(
      ['missing', 'trustwallet'],
      new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]]),
    )

    // trustwallet keeps tier 1 (1000) rather than sliding up into the empty
    // provider's slot — otherwise a provider that fails to discover would
    // silently promote everything behind it.
    expect(rankings).toEqual([{ providerKey: 'trustwallet', listKey: 'wallet', ranking: 1000 }])
  })

  it('returns nothing when no collectable has a manifest', async () => {
    const { computeRankings } = await loadSyncOrder()
    expect(computeRankings(['a', 'b'], new Map())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// syncDefaultOrder
// ---------------------------------------------------------------------------

describe('syncDefaultOrder', () => {
  it('writes the computed rankings as order items under the gibs provider', async () => {
    const { syncDefaultOrder } = await loadSyncOrder()
    await syncDefaultOrder(
      ['trustwallet'],
      new Map([['trustwallet', manifestOf({ trustwallet: ['wallet', 'extra'] })]]),
    )

    expect(dbMock.insertProvider).toHaveBeenCalledWith({ key: 'gibs' })
    const [order, items] = dbMock.insertOrder.mock.calls[0]
    expect(order).toMatchObject({ providerId: 'gibs-provider-id', type: 'default', key: 'default' })
    expect(items).toEqual([
      { providerId: 'provider-id:trustwallet', listKey: 'extra', ranking: 0 },
      { providerId: 'provider-id:trustwallet', listKey: 'wallet', ranking: 1 },
    ])
  })

  it('caches the resulting order id for later reads', async () => {
    const { syncDefaultOrder, getDefaultListOrderId } = await loadSyncOrder()
    expect(getDefaultListOrderId()).toBeNull()

    await syncDefaultOrder(['trustwallet'], new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]]))

    expect(getDefaultListOrderId()).toBe('0xorder')
  })

  it('clears the previous order items before inserting the new set', async () => {
    const { syncDefaultOrder } = await loadSyncOrder()
    drizzleState.rows = [{ listOrderId: 'existing-order' }]

    await syncDefaultOrder(['trustwallet'], new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]]))

    // Without the delete, a list dropped from a provider would keep its stale
    // ranking row and go on influencing image priority forever.
    expect(drizzleState.deletes).toHaveLength(1)
  })

  it('skips the delete when there is no existing order', async () => {
    const { syncDefaultOrder } = await loadSyncOrder()
    drizzleState.rows = []

    await syncDefaultOrder(['trustwallet'], new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]]))

    expect(drizzleState.deletes).toHaveLength(0)
    expect(dbMock.insertOrder).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when there are no rankings to sync', async () => {
    const { syncDefaultOrder } = await loadSyncOrder()
    await syncDefaultOrder([], new Map())

    // An empty manifest set means discovery produced nothing; wiping the live
    // order in that case would drop image priority for the whole catalogue.
    expect(dbMock.insertProvider).not.toHaveBeenCalled()
    expect(dbMock.insertOrder).not.toHaveBeenCalled()
  })

  it('serialises concurrent syncs so only one runs', async () => {
    const { syncDefaultOrder } = await loadSyncOrder()
    const manifests = new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]])

    let release: () => void = () => {}
    dbMock.insertProvider.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve([{ providerId: 'gibs-provider-id' }]))),
    )

    const first = syncDefaultOrder(['trustwallet'], manifests)
    // Second call lands while the first still holds the lock and must no-op
    // rather than racing it into a duplicate insert.
    await syncDefaultOrder(['trustwallet'], manifests)
    release()
    await first

    expect(dbMock.insertProvider).toHaveBeenCalledTimes(1)
  })

  it('releases the lock when a sync throws', async () => {
    const { syncDefaultOrder } = await loadSyncOrder()
    const manifests = new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]])
    dbMock.insertProvider.mockRejectedValueOnce(new Error('database down'))

    await expect(syncDefaultOrder(['trustwallet'], manifests)).rejects.toThrow('database down')

    // A failed sync must not wedge the lock — otherwise one transient database
    // error would freeze ordering until the process restarts.
    dbMock.insertProvider.mockResolvedValue([{ providerId: 'gibs-provider-id' }])
    await syncDefaultOrder(['trustwallet'], manifests)
    expect(dbMock.insertOrder).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// buildManifestsFromDB
// ---------------------------------------------------------------------------

describe('buildManifestsFromDB', () => {
  it('groups stored lists under their collectable key', async () => {
    const { buildManifestsFromDB } = await loadSyncOrder()
    drizzleState.rows = [
      { providerKey: 'trustwallet', listKey: 'wallet' },
      { providerKey: 'trustwallet', listKey: 'wallet-ethereum' },
    ]

    const manifests = await buildManifestsFromDB(['trustwallet'])

    expect(manifests.get('trustwallet')).toEqual([
      { providerKey: 'trustwallet', lists: [{ listKey: 'wallet' }, { listKey: 'wallet-ethereum' }] },
    ])
  })

  it('folds uniswap-* providers into the uniswap-tokenlists collectable', async () => {
    const { buildManifestsFromDB } = await loadSyncOrder()
    drizzleState.rows = [
      { providerKey: 'uniswap-aave', listKey: 'hosted' },
      { providerKey: 'uniswap-compound', listKey: 'hosted' },
    ]

    const manifests = await buildManifestsFromDB(['uniswap-tokenlists'])

    // The dynamic providers do not share their parent's key, so without this
    // prefix rule they would rebuild with no ranking tier at all.
    expect(manifests.get('uniswap-tokenlists')).toHaveLength(2)
  })

  it('folds *-bridge providers into the omnibridge collectable', async () => {
    const { buildManifestsFromDB } = await loadSyncOrder()
    drizzleState.rows = [{ providerKey: 'gnosis-bridge', listKey: 'tokens' }]

    const manifests = await buildManifestsFromDB(['omnibridge'])

    expect(manifests.get('omnibridge')).toEqual([{ providerKey: 'gnosis-bridge', lists: [{ listKey: 'tokens' }] }])
  })

  it('does not fold an unrelated provider into omnibridge', async () => {
    const { buildManifestsFromDB } = await loadSyncOrder()
    drizzleState.rows = [{ providerKey: 'trustwallet', listKey: 'wallet' }]

    const manifests = await buildManifestsFromDB(['omnibridge'])

    // The suffix rule has to stay narrow: sweeping a non-bridge provider into
    // omnibridge would hand it that tier's image priority.
    expect(manifests.size).toBe(0)
  })

  it('omits collectables with no stored lists and skips incomplete rows', async () => {
    const { buildManifestsFromDB } = await loadSyncOrder()
    drizzleState.rows = [
      { providerKey: 'trustwallet', listKey: null },
      { providerKey: null, listKey: 'orphan' },
    ]

    const manifests = await buildManifestsFromDB(['trustwallet', 'coingecko'])

    expect(manifests.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// startPeriodicRefresh
// ---------------------------------------------------------------------------

describe('startPeriodicRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-syncs on each interval and stops when the returned function is called', async () => {
    const { startPeriodicRefresh } = await loadSyncOrder()
    const manifests = new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]])

    const stop = startPeriodicRefresh(['trustwallet'], manifests, 1_000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(dbMock.insertOrder).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(5_000)
    // No further syncs after stopping — a leaked interval would keep writing
    // against a closed pool during shutdown.
    expect(dbMock.insertOrder).toHaveBeenCalledTimes(2)
  })

  it('swallows sync failures so a transient error cannot kill the timer', async () => {
    const { startPeriodicRefresh } = await loadSyncOrder()
    const manifests = new Map([['trustwallet', manifestOf({ trustwallet: ['wallet'] })]])
    dbMock.insertProvider.mockRejectedValueOnce(new Error('database down'))

    const stop = startPeriodicRefresh(['trustwallet'], manifests, 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    // A rejection here would surface as an unhandled rejection and take the
    // process down; stale ordering is the deliberate trade.
    await vi.advanceTimersByTimeAsync(1_000)

    expect(dbMock.insertOrder).toHaveBeenCalledTimes(1)
    stop()
  })

  it('is safe to stop more than once', async () => {
    const { startPeriodicRefresh } = await loadSyncOrder()
    const stop = startPeriodicRefresh(['trustwallet'], new Map(), 1_000)

    stop()
    // Shutdown paths call the stopper defensively; the second call clears a
    // timer that is already null and must not throw.
    expect(() => stop()).not.toThrow()
  })
})
