import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock, renderSql, sqlParams } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('../log/App', () => createLogAppMock())

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('../fetch', () => ({ fetch: fetchMock }))

// Static imports so the module graph loads once during file setup rather than
// inside a test's own timeout budget — see index.order.test.ts.
import {
  getVariant,
  insertVariant,
  bumpVariantAccess,
  pruneVariants,
  getCachedRequest,
  purgeExpiredCache,
  clearCache,
  insertCacheRequest,
  cachedJSON,
  cachedJSONRequest,
  transaction,
} from './index'

beforeEach(() => {
  harness.reset()
  fetchMock.mockReset()
})

// ---------------------------------------------------------------------------
// image variant cache
// ---------------------------------------------------------------------------

describe('getVariant', () => {
  it('matches on the full (imageHash, width, height, format) key', async () => {
    harness.queueResult([{ imageHash: 'hash-1', width: 32, height: 32, format: 'webp' }])

    const result = await getVariant('hash-1', 32, 32, 'webp')

    const selectQuery = harness.queries[0]
    const whereStep = selectQuery.steps.find((step) => step.method === 'where')
    // All four dimensions must be bound, or a 32x32 webp request could return a
    // differently-sized or differently-formatted cached variant.
    expect(sqlParams(whereStep?.args[0])).toEqual(['hash-1', 32, 32, 'webp'])
    expect(result).toMatchObject({ width: 32 })
  })
})

describe('insertVariant', () => {
  it('refreshes content and last-accessed time on a re-generated variant', async () => {
    harness.queueResult(undefined)

    await insertVariant({ imageHash: 'hash-1', width: 32, height: 32, format: 'webp', content: Buffer.from('bytes') })

    const insertQuery = harness.queries[0]
    const conflictStep = insertQuery.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { target: unknown[]; set: Record<string, unknown> }
    expect(conflictArgs.target).toHaveLength(4)
    expect(Object.keys(conflictArgs.set).sort()).toEqual(['content', 'lastAccessedAt'])
  })
})

describe('bumpVariantAccess', () => {
  it('increments accessCount rather than overwriting it with a literal', async () => {
    harness.queueResult(undefined)

    await bumpVariantAccess('hash-1', 32, 32, 'webp')

    const updateQuery = harness.queries[0]
    const setStep = updateQuery.steps.find((step) => step.method === 'set')
    const setArgs = setStep?.args[0] as { accessCount: unknown }
    // "+ 1" against the existing column, not a hardcoded value — every prune
    // decision depends on this counting real repeated access, not one write.
    expect(renderSql(setArgs.accessCount)).toContain('+')
  })
})

describe('pruneVariants', () => {
  it('deletes cold variants, then resets every survivor access count back to zero', async () => {
    harness.queueResult([{ imageHash: 'hash-1' }, { imageHash: 'hash-2' }])
    harness.queueResult(undefined)

    const deletedCount = await pruneVariants(3, 24)

    expect(deletedCount).toBe(2)
    const deleteQuery = harness.queries.find((query) => query.root === 'delete')
    const whereStep = deleteQuery?.steps.find((step) => step.method === 'where')
    expect(renderSql(whereStep?.args[0])).toContain('access_count')
    // A survivor's counter resets after every prune sweep — otherwise a
    // variant accessed once years ago would count toward "hot" forever and
    // never actually get evaluated for eviction again on a fair basis.
    const updateQuery = harness.queries.find((query) => query.root === 'update')
    expect(updateQuery?.steps.find((step) => step.method === 'set')?.args[0]).toEqual({ accessCount: 0 })
  })
})

// ---------------------------------------------------------------------------
// generic key/value request cache
// ---------------------------------------------------------------------------

describe('getCachedRequest', () => {
  it('only returns a row that has not yet expired', async () => {
    harness.queueResult([{ key: 'k1', value: '{}' }])

    const result = await getCachedRequest('k1')

    const selectQuery = harness.queries[0]
    const whereStep = selectQuery.steps.find((step) => step.method === 'where')
    expect(renderSql(whereStep?.args[0])).toContain('expires_at')
    expect(result).toMatchObject({ key: 'k1' })
  })
})

describe('purgeExpiredCache', () => {
  it('deletes only rows whose expiry has already passed', async () => {
    harness.queueResult(undefined)

    await purgeExpiredCache()

    const deleteQuery = harness.queries[0]
    expect(deleteQuery.steps.some((step) => step.method === 'where')).toBe(true)
  })
})

describe('clearCache', () => {
  it('issues a delete with no WHERE clause, wiping every cached request', async () => {
    harness.queueResult(undefined)

    await clearCache()

    const deleteQuery = harness.queries[0]
    expect(deleteQuery.steps.some((step) => step.method === 'where')).toBe(false)
  })
})

describe('insertCacheRequest', () => {
  it('refreshes value and expiry on a repeated key, not the key itself', async () => {
    harness.queueResult(undefined)

    await insertCacheRequest({ key: 'k1', value: '{}', expiresAt: new Date().toISOString() })

    const insertQuery = harness.queries[0]
    const conflictStep = insertQuery.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { set: Record<string, unknown> }
    expect(Object.keys(conflictArgs.set).sort()).toEqual(['expiresAt', 'value'])
  })
})

describe('cachedJSON', () => {
  it('returns the cached value without calling fn when a valid cache hit exists', async () => {
    harness.queueResult([{ key: 'k1', value: JSON.stringify({ hit: true }) }])
    const fn = vi.fn()

    const result = await cachedJSON('k1', new AbortController().signal, fn)

    expect(result).toEqual({ hit: true })
    expect(fn).not.toHaveBeenCalled()
    expect(harness.queries).toHaveLength(1)
  })

  it('re-fetches when a validator rejects the cached value, e.g. a previously cached error body', async () => {
    harness.queueResult([{ key: 'k1', value: JSON.stringify({ error: 'rate limited' }) }])
    harness.queueResult(undefined) // insertCacheRequest for the fresh result
    const fn = vi.fn().mockResolvedValue({ ok: true })
    const validate = (value: unknown) => (value as { error?: string }).error === undefined

    const result = await cachedJSON('k1', new AbortController().signal, fn, { validate })

    expect(fn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  it('does not persist a fresh result that itself fails validation', async () => {
    harness.queueResult([]) // no cached row
    const fn = vi.fn().mockResolvedValue({ error: 'still rate limited' })
    const validate = (value: unknown) => (value as { error?: string }).error === undefined

    await cachedJSON('k1', new AbortController().signal, fn, { validate })

    // Caching a known-bad response would keep serving the failure for the full
    // TTL instead of retrying on the next request.
    expect(harness.queries).toHaveLength(1)
  })

  it('fetches fresh and writes through when there is no cache entry at all', async () => {
    harness.queueResult([])
    harness.queueResult(undefined)
    const fn = vi.fn().mockResolvedValue({ fresh: true })

    const result = await cachedJSON('k1', new AbortController().signal, fn)

    expect(result).toEqual({ fresh: true })
    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as { value: string }
    expect(JSON.parse(row.value)).toEqual({ fresh: true })
  })
})

describe('cachedJSONRequest', () => {
  it("shares cachedJSON's cache-hit short-circuit, never reaching the network", async () => {
    const jsonResponse = { hello: 'world' }
    harness.queueResult([{ key: 'k2', value: JSON.stringify(jsonResponse) }])

    const result = await cachedJSONRequest('k2', new AbortController().signal, 'https://example.com/data.json')

    expect(result).toEqual(jsonResponse)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(harness.queries).toHaveLength(1)
  })

  it('fetches, parses the JSON body, and forwards the request init through to fetch on a cache miss', async () => {
    harness.queueResult([]) // no cached row
    harness.queueResult(undefined) // insertCacheRequest for the fresh result
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ fresh: 'data' }) })

    const result = await cachedJSONRequest('k3', new AbortController().signal, 'https://example.com/data.json', {
      headers: { Accept: 'application/json' },
    })

    expect(result).toEqual({ fresh: 'data' })
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; signal: AbortSignal }]
    // The caller's extra fetch options (headers, method, …) must reach the
    // underlying request alongside the abort signal — dropping them would
    // silently strip auth headers or method overrides from every cached call site.
    expect(url).toBe('https://example.com/data.json')
    expect(init.headers).toEqual({ Accept: 'application/json' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('defaults to an empty request init when the caller passes no fetch options at all', async () => {
    harness.queueResult([])
    harness.queueResult(undefined)
    fetchMock.mockResolvedValue({ json: () => Promise.resolve({ fresh: 'data' }) })

    await cachedJSONRequest('k4', new AbortController().signal, 'https://example.com/data.json')

    const [, init] = fetchMock.mock.calls[0] as [string, { signal: AbortSignal }]
    // No options argument was passed at all — `args[1]` is undefined, and the
    // `?? {}` fallback is what keeps the spread from throwing.
    expect(init).toEqual({ signal: expect.any(AbortSignal) })
  })
})

// ---------------------------------------------------------------------------
// transaction
// ---------------------------------------------------------------------------

describe('transaction', () => {
  it('runs the callback with the transaction handle and returns its result', async () => {
    const result = await transaction(async (tx) => {
      expect(tx).toBe(harness.db)
      return 'done'
    })

    expect(result).toBe('done')
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
  })
})
