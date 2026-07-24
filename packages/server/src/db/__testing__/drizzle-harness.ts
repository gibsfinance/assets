/**
 * @module drizzle-harness
 * Shared Drizzle object-relational-mapping test harness for `packages/server/src/db/index.ts`.
 *
 * Every exported query in `db/index.ts` reaches the database through `getDrizzle()` and
 * then chains method calls off the returned handle — for example
 * `db.select().from(table).where(condition).limit(1)`,
 * `db.insert(table).values(row).onConflictDoUpdate({ target, set }).returning()`, or
 * `db.execute(sql\`...\`)`. This harness stands in for that handle without a real
 * Postgres connection.
 *
 * The trick (carried over from `sync-order.test.ts`, extended here to cover insert and
 * raw-execute shapes): every chain method records its own invocation and returns the same
 * chain object, and the chain object is also thenable. That means both
 * `await db.select().from(table).where(condition)` and
 * `await db.select().from(table).where(condition).limit(1)` resolve to whatever the test
 * queued, regardless of which method the production code happens to call last.
 *
 * Usage in a test file:
 *
 * ```ts
 * import { beforeEach, describe, expect, it, vi } from 'vitest'
 * import { createDrizzleHarness, renderSql } from './__testing__/drizzle-harness'
 *
 * const harness = createDrizzleHarness()
 * vi.mock('./drizzle', () => ({ getDrizzle: () => harness.db }))
 *
 * beforeEach(() => harness.reset())
 *
 * describe('insertToken', () => {
 *   it('targets the network/provided-id unique constraint on conflict', async () => {
 *     const { insertToken } = await import('./index')
 *     harness.queueResult([{ tokenId: 'token-1' }])
 *
 *     await insertToken({ networkId: 'network-1', providedId: '0xabc', name: 'Coin', symbol: 'COIN', decimals: 18 })
 *
 *     const insertQuery = harness.queries.find((query) => query.root === 'insert')
 *     const conflict = insertQuery?.steps.find((step) => step.method === 'onConflictDoUpdate')
 *     expect(Object.keys((conflict?.args[0] as { set: object }).set)).toEqual(['tokenId'])
 *   })
 * })
 * ```
 *
 * `renderSql` turns a Drizzle `SQL` fragment (anything built from the `sql` tagged
 * template) into the literal text Postgres would receive, via Drizzle's own `PgDialect`.
 * Use it to assert on the actual expression a conflict-update or ordering clause
 * produces — e.g. that a COALESCE preserves a prior value — rather than re-stating the
 * source code as a tautology.
 */
import { is, SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const dialect = new PgDialect({ casing: 'snake_case' })

/**
 * Render a Drizzle SQL fragment to the literal SQL text it compiles to. Non-SQL
 * values pass through `String()` so a call site does not need to branch on whether
 * a captured argument happens to be a raw fragment or a plain value.
 *
 * Column/value comparisons (`eq`, `ilike`, …) render as a parameter placeholder
 * (`$1`) rather than the literal value — Drizzle binds those out-of-band. Use
 * `sqlParams` alongside this to assert on the bound value itself, e.g. that a
 * fragment search actually wraps its input in `%…%` wildcards.
 */
export const renderSql = (value: unknown): string => {
  if (is(value, SQL)) {
    return dialect.sqlToQuery(value).sql
  }
  return String(value)
}

/** The bound parameter values for a Drizzle SQL fragment, in placeholder order. */
export const sqlParams = (value: unknown): unknown[] => {
  if (is(value, SQL)) {
    return dialect.sqlToQuery(value).params
  }
  return []
}

/** One method call recorded on a chain, in the order it happened. */
export type RecordedStep = { method: string; args: unknown[] }

/** One top-level `db.select()` / `db.insert()` / `db.execute()` / … call and every
 * chained method invoked on the object it returned. */
export type RecordedQuery = { root: string; steps: RecordedStep[] }

const chainMethods = [
  'from',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'where',
  'set',
  'values',
  'onConflictDoUpdate',
  'onConflictDoNothing',
  'orderBy',
  'groupBy',
  '$dynamic',
] as const

const terminalMethods = ['limit', 'returning'] as const

/**
 * Create one harness instance. Each test file that mocks `./drizzle` should build
 * exactly one of these at module scope and reset it in `beforeEach` — the queued
 * results and recorded queries are the only per-test state; the chain-building
 * logic itself is stateless and safe to share.
 */
/** Sentinel wrapper: a queued entry the next query rejects with, instead of resolving. */
class QueuedRejection {
  constructor(readonly error: unknown) {}
}

export const createDrizzleHarness = () => {
  let queue: unknown[] = []
  let queries: RecordedQuery[] = []

  const nextResult = () => {
    if (queue.length === 0) {
      throw new Error(
        'drizzle-harness: no queued result. Call harness.queueResult(value) once for every ' +
          'query the code under test issues, in the order it issues them.',
      )
    }
    const entry = queue.shift()
    if (entry instanceof QueuedRejection) {
      throw entry.error
    }
    return entry
  }

  const startQuery = (root: string, rootArgs: unknown[]) => {
    const record: RecordedQuery = { root, steps: [{ method: root, args: rootArgs }] }
    queries.push(record)
    const chain: Record<string, unknown> = {}
    for (const method of chainMethods) {
      chain[method] = (...args: unknown[]) => {
        record.steps.push({ method, args })
        return chain
      }
    }
    for (const method of terminalMethods) {
      chain[method] = (...args: unknown[]) => {
        record.steps.push({ method, args })
        return Promise.resolve(nextResult())
      }
    }
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(nextResult()).then(resolve, reject)
    return chain
  }

  const db = {
    select: (...args: unknown[]) => startQuery('select', args),
    selectDistinct: (...args: unknown[]) => startQuery('selectDistinct', args),
    insert: (...args: unknown[]) => startQuery('insert', args),
    update: (...args: unknown[]) => startQuery('update', args),
    delete: (...args: unknown[]) => startQuery('delete', args),
    execute: (...args: unknown[]) => {
      queries.push({ root: 'execute', steps: [{ method: 'execute', args }] })
      return Promise.resolve(nextResult())
    },
    transaction: async (callback: (tx: unknown) => unknown) => {
      queries.push({ root: 'transaction', steps: [{ method: 'transaction', args: [] }] })
      return callback(db)
    },
  }

  return {
    db,
    /** Queue the value the next query issued by the code under test resolves to. */
    queueResult: (value: unknown) => {
      queue.push(value)
    },
    /**
     * Queue an error the next query rejects with — for exercising a catch block
     * around a database call, e.g. a transaction whose insert throws mid-way.
     */
    queueRejection: (error: unknown) => {
      queue.push(new QueuedRejection(error))
    },
    /** Every top-level query issued since the last reset, in call order. */
    get queries() {
      return queries
    },
    /** Clear queued results and recorded queries between tests. */
    reset: () => {
      queue = []
      queries = []
    },
  }
}

export type DrizzleHarness = ReturnType<typeof createDrizzleHarness>

/**
 * `db/index.ts` imports `../utils`, which instantiates the Ink-based terminal
 * logger at module load time (`export const terminal = terminalRow.issue(...)`).
 * Ink's console patching does not run under Vitest's environment, so every test
 * file that imports the real `db/index.ts` module must mock `../log/App` before
 * doing so — mirroring the existing pattern in
 * `server/list/tokens-by-chain-cache.test.ts`. An endlessly-chainable no-op proxy
 * stands in for the terminal row/section objects the rest of `utils` reads.
 *
 * Usage: `vi.mock('../log/App', () => createLogAppMock())`, placed above any
 * `import('./index')` in the same test file.
 */
export const createLogAppMock = () => {
  const noop: unknown = new Proxy(function () {}, { get: () => noop, apply: () => noop })
  return { createTerminal: () => noop, forceRerender: () => {} }
}
