import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, createLogAppMock, renderSql } from './__testing__/drizzle-harness'

const harness = createDrizzleHarness()
vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('../log/App', () => createLogAppMock())

// Static imports (rather than a per-test `await import('./index')`) so the
// module graph loads once during file setup instead of inside a test's own
// timeout budget — see index.order.test.ts for the flakiness this avoids.
import {
  ids,
  insertToken,
  insertTokenBatch,
  storeToken,
  insertList,
  insertProvider,
  insertOrder,
  insertListToken,
} from './index'

beforeEach(() => {
  harness.reset()
})

// ---------------------------------------------------------------------------
// ids — pure hashing helpers with no database involvement
// ---------------------------------------------------------------------------

describe('ids', () => {
  it('provider hashes the key deterministically and distinguishes different keys', async () => {
    const first = ids.provider('trustwallet')
    const second = ids.provider('trustwallet')
    const third = ids.provider('coingecko')

    // Determinism is what lets a collector re-derive the same provider id on
    // every run instead of minting duplicate provider rows.
    expect(first).toBe(second)
    expect(first).not.toBe(third)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })

  it('list folds every version component into the hash', async () => {
    const base = { providerId: 'p1', key: 'default', major: 1, minor: 0, patch: 0 }
    const bumpedPatch = ids.list({ ...base, patch: 1 })
    const bumpedMinor = ids.list({ ...base, minor: 1 })

    // If patch or minor were dropped from the hash input, two different list
    // versions would collide on the same list id and overwrite each other.
    expect(ids.list(base)).not.toBe(bumpedPatch)
    expect(ids.list(base)).not.toBe(bumpedMinor)
  })

  it('imageHash changes with the source uri and extension, not just the bytes', async () => {
    const bytes = Buffer.from([1, 2, 3])
    const fromUriA = ids.imageHash(bytes, 'https://a.example/icon.png', '.png')
    const fromUriB = ids.imageHash(bytes, 'https://b.example/icon.png', '.png')
    const fromExtSvg = ids.imageHash(bytes, 'https://a.example/icon.png', '.svg')

    // Two providers can serve byte-identical placeholder images at different
    // URIs; folding the uri and ext into the hash keeps them as separate rows
    // instead of one provider's re-fetch silently overwriting another's link.
    expect(fromUriA).not.toBe(fromUriB)
    expect(fromUriA).not.toBe(fromExtSvg)
  })
})

// ---------------------------------------------------------------------------
// insertToken
// ---------------------------------------------------------------------------

describe('insertToken', () => {
  it('lowercases an EVM provided id and strips null bytes from name/symbol', async () => {
    harness.queueResult([{ tokenId: 'token-1' }])

    await insertToken({
      networkId: 'network-1',
      providedId: '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD',
      name: 'Bad\x00Name',
      symbol: 'BAD\x00',
      decimals: 18,
    })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const valuesStep = insertQuery?.steps.find((step) => step.method === 'values')
    const row = valuesStep?.args[0] as { providedId: string; name: string; symbol: string }
    expect(row.providedId).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    expect(row.name).toBe('BadName')
    expect(row.symbol).toBe('BAD')
  })

  it('a conflicting (network, providedId) row is returned without overwriting its stored fields', async () => {
    harness.queueResult([{ tokenId: 'token-1' }])

    await insertToken({
      networkId: 'network-1',
      providedId: '0x1111111111111111111111111111111111111111',
      name: 'Coin',
      symbol: 'COIN',
      decimals: 18,
    })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const conflictStep = insertQuery?.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { target: unknown[]; set: Record<string, unknown> }
    // The conflict update only re-asserts tokenId (a no-op) so RETURNING yields the
    // existing row's key — the row's own name/symbol/decimals are never rewritten by
    // a later collection run under a different upstream casing of the same token.
    expect(Object.keys(conflictArgs.set)).toEqual(['tokenId'])
    expect(renderSql(conflictArgs.set.tokenId)).toBe('token.token_id')
  })
})

// ---------------------------------------------------------------------------
// insertTokenBatch
// ---------------------------------------------------------------------------

describe('insertTokenBatch', () => {
  it('short-circuits on an empty batch without issuing any query', async () => {
    const result = await insertTokenBatch([])
    expect(result).toEqual([])
    expect(harness.queries).toHaveLength(0)
  })

  it('splits a batch larger than the parameter-limit chunk size into multiple inserts', async () => {
    const tokens = Array.from({ length: 501 }, (_, index) => ({
      networkId: 'network-1',
      providedId: `0x${index.toString(16).padStart(40, '0')}`,
      name: `Token ${index}`,
      symbol: `T${index}`,
      decimals: 18,
    }))
    harness.queueResult(tokens.slice(0, 500).map((t) => ({ tokenId: t.providedId })))
    harness.queueResult(tokens.slice(500).map((t) => ({ tokenId: t.providedId })))

    const result = await insertTokenBatch(tokens)

    const insertQueries = harness.queries.filter((query) => query.root === 'insert')
    expect(insertQueries).toHaveLength(2)
    const firstChunk = insertQueries[0].steps.find((step) => step.method === 'values')?.args[0] as unknown[]
    const secondChunk = insertQueries[1].steps.find((step) => step.method === 'values')?.args[0] as unknown[]
    // 500 rows/chunk keeps every insert under Postgres's ~65535 bound-parameter
    // limit; a batch one row over the limit must still land as two statements
    // rather than one that Postgres would reject outright.
    expect(firstChunk).toHaveLength(500)
    expect(secondChunk).toHaveLength(1)
    expect(result).toHaveLength(501)
  })
})

// ---------------------------------------------------------------------------
// storeToken
// ---------------------------------------------------------------------------

describe('storeToken', () => {
  it('threads the freshly inserted token id into the list-token insert', async () => {
    harness.queueResult([{ tokenId: 'token-9' }])
    harness.queueResult([{ listTokenId: 'lt-1', tokenId: 'token-9', listId: 'list-1' }])

    const result = await storeToken({
      token: {
        networkId: 'network-1',
        providedId: '0x2222222222222222222222222222222222222222',
        name: 'X',
        symbol: 'X',
        decimals: 18,
      },
      listId: 'list-1',
      imageHash: 'hash-1',
      listTokenOrderId: 3,
    })

    const listTokenInsert = harness.queries.filter((query) => query.root === 'insert')[1]
    const row = listTokenInsert.steps.find((step) => step.method === 'values')?.args[0] as { tokenId: string }[]
    // The list-token row must reference the token id insertToken actually
    // returned, not the caller's input — the two can diverge on a conflict.
    expect(row[0].tokenId).toBe('token-9')
    expect(result.token.tokenId).toBe('token-9')
    expect(result.listToken.listTokenId).toBe('lt-1')
  })
})

// ---------------------------------------------------------------------------
// insertList
// ---------------------------------------------------------------------------

describe('insertList', () => {
  it('defaults version fields to zero and quotes the reserved "default" column on conflict', async () => {
    harness.queueResult([{ listId: 'list-1' }])

    await insertList({ providerId: 'provider-1', key: 'wallet' })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const valuesStep = insertQuery?.steps.find((step) => step.method === 'values')
    const row = valuesStep?.args[0] as { major: number; minor: number; patch: number }
    expect(row).toMatchObject({ major: 0, minor: 0, patch: 0 })

    const conflictStep = insertQuery?.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { set: Record<string, unknown> }
    // "default" is a reserved SQL keyword; unquoted it would fail to parse.
    // Losing the quoting here only breaks on a real Postgres round-trip, so it
    // must be pinned down at the unit level.
    expect(renderSql(conflictArgs.set.default)).toBe('excluded."default"')
  })
})

// ---------------------------------------------------------------------------
// insertProvider
// ---------------------------------------------------------------------------

describe('insertProvider', () => {
  it('wraps a single provider into a one-element batch, same as an explicit array', async () => {
    harness.queueResult([{ providerId: 'p-1' }])

    await insertProvider({ key: 'trustwallet' })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as unknown[]
    expect(Array.isArray(row)).toBe(true)
    expect(row).toHaveLength(1)
  })

  it('passes an explicit array of providers straight through', async () => {
    harness.queueResult([{ providerId: 'p-1' }, { providerId: 'p-2' }])

    await insertProvider([{ key: 'trustwallet' }, { key: 'coingecko' }])

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as unknown[]
    expect(row).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// insertOrder
// ---------------------------------------------------------------------------

describe('insertOrder', () => {
  it('keeps the last order item when two share a ranking, and defaults listId to null', async () => {
    harness.queueResult([{ listOrderId: 'order-1' }])
    harness.queueResult([{ listOrderId: 'order-1', ranking: 0, listKey: 'second', providerId: 'p1' }])

    await insertOrder({ providerId: 'p1', key: 'default', type: 'default' }, [
      { providerId: 'p1', listKey: 'first', ranking: 0 },
      { providerId: 'p1', listKey: 'second', ranking: 0 },
    ])

    const itemInsert = harness.queries.filter((query) => query.root === 'insert')[1]
    const rows = itemInsert.steps.find((step) => step.method === 'values')?.args[0] as {
      listKey: string
      listId: unknown
    }[]
    // A ranking collision must resolve deterministically to one row, or the
    // primary key (listOrderId, ranking) insert would throw in Postgres.
    expect(rows).toHaveLength(1)
    expect(rows[0].listKey).toBe('second')
    expect(rows[0].listId).toBeNull()
  })

  it('skips the item insert entirely when there are no order items to write', async () => {
    harness.queueResult([{ listOrderId: 'order-1' }])

    const result = await insertOrder({ providerId: 'p1', key: 'default', type: 'default' }, [])

    expect(result).toEqual({ order: { listOrderId: 'order-1' }, listOrderItems: [] })
    expect(harness.queries.filter((query) => query.root === 'insert')).toHaveLength(1)
  })

  it('runs inside the caller-supplied transaction instead of opening a new one', async () => {
    harness.queueResult([{ listOrderId: 'order-1' }])

    await insertOrder({ providerId: 'p1', key: 'default', type: 'default' }, [], harness.db as never)

    // Passing a transaction handle must not also wrap the call in
    // getDrizzle().transaction(...) — that would nest transactions and, on a
    // real pool, deadlock or silently commit early.
    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(false)
  })

  it('opens its own transaction when no transaction handle is supplied', async () => {
    harness.queueResult([{ listOrderId: 'order-1' }])

    await insertOrder({ providerId: 'p1', key: 'default', type: 'default' }, [])

    expect(harness.queries.some((query) => query.root === 'transaction')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// insertListToken
// ---------------------------------------------------------------------------

describe('insertListToken', () => {
  it('coalesces image_hash so a fetch-less re-collection cannot clobber a good icon', async () => {
    harness.queueResult([{ listTokenId: 'lt-1' }])

    await insertListToken({ tokenId: 'token-1', listId: 'list-1', imageHash: undefined, listTokenOrderId: 1 })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const conflictStep = insertQuery?.steps.find((step) => step.method === 'onConflictDoUpdate')
    const conflictArgs = conflictStep?.args[0] as { set: Record<string, unknown> }
    // Regression test for the icon-freeze bug: COALESCE must prefer the
    // incoming value and only fall back to the stored one, in that order.
    expect(renderSql(conflictArgs.set.imageHash)).toBe('COALESCE(excluded.image_hash, "list_token"."image_hash")')
    // listTokenOrderId is always overwritten — unlike imageHash it is not
    // preserved from a prior run, since order is expected to shift freely.
    expect(renderSql(conflictArgs.set.listTokenOrderId)).toBe('excluded.list_token_order_id')
  })

  it('normalizes a single list-token input into the same array shape as a batch', async () => {
    harness.queueResult([{ listTokenId: 'lt-1' }])

    await insertListToken({ tokenId: 'token-1', listId: 'list-1', listTokenOrderId: 1 })

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as unknown[]
    expect(Array.isArray(row)).toBe(true)
    expect(row).toHaveLength(1)
  })

  it('passes an explicit array of list-tokens straight through', async () => {
    harness.queueResult([{ listTokenId: 'lt-1' }, { listTokenId: 'lt-2' }])

    await insertListToken([
      { tokenId: 'token-1', listId: 'list-1', listTokenOrderId: 1 },
      { tokenId: 'token-2', listId: 'list-1', listTokenOrderId: 2 },
    ])

    const insertQuery = harness.queries.find((query) => query.root === 'insert')
    const row = insertQuery?.steps.find((step) => step.method === 'values')?.args[0] as unknown[]
    expect(row).toHaveLength(2)
  })
})
