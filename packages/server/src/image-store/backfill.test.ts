import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from '../db/__testing__/drizzle-harness'
import { createMemoryBlobStore } from './__testing__/memory-store'
import { hashBytes } from './hash'
import { exportImages, importImages, verifyImages, EXAMPLE_LIMIT } from './backfill'

const harness = createDrizzleHarness()
/** The harness stands in for the Drizzle handle; its chain types are looser than the real ones. */
const fakeDatabase = harness.db as never
vi.mock('../logger', () => ({ log: vi.fn() }))
vi.mock('../db/drizzle', () => ({ getDrizzle: () => harness.db }))

const first = Buffer.from('first picture')
const second = Buffer.from('second picture')

/** The step of a recorded query with this method name. */
const stepOf = (query: (typeof harness.queries)[number], method: string) =>
  query.steps.find((step) => step.method === method)

const renderedWhere = (query: (typeof harness.queries)[number]) => renderSql(stepOf(query, 'where')?.args[0])

beforeEach(() => {
  harness.reset()
})

describe('exportImages', () => {
  it('writes each file before marking its row, and records the digest and length of the stored bytes', async () => {
    const store = createMemoryBlobStore()
    const filesWhenMarked: number[] = []
    const fakeDatabase = {
      ...harness.db,
      update: (...args: Parameters<typeof harness.db.update>) => {
        filesWhenMarked.push(store.blobs.size)
        return harness.db.update(...args)
      },
    } as never
    harness.queueResult([{ imageHash: 'hash-a', content: first }])
    harness.queueResult([{ imageHash: 'hash-a' }]) // the mark
    harness.queueResult([]) // no more rows

    const summary = await exportImages({ database: fakeDatabase, store })

    expect(filesWhenMarked).toEqual([1])
    expect(summary).toEqual({ examined: 1, exported: 1, empty: 0, skipped: 0, bytes: first.length })
    const update = harness.queries.find((query) => query.root === 'update')!
    expect(stepOf(update, 'set')?.args[0]).toEqual({ contentSha256: hashBytes(first), byteSize: first.length })
  })

  it('marks only rows not yet marked, and only while the bytes are still the ones that were copied', async () => {
    harness.queueResult([{ imageHash: 'hash-a', content: first }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    await exportImages({ database: fakeDatabase, store: createMemoryBlobStore() })

    const update = harness.queries.find((query) => query.root === 'update')!
    const where = renderedWhere(update)
    expect(where).toContain('"image"."byte_size" is null')
    expect(where).toContain('encode(sha256("image"."content"), \'hex\') = $')
    // The bound digest is the file's, so a row rewritten since it was read cannot be marked.
    expect(sqlParams(stepOf(update, 'where')?.args[0])).toContain(hashBytes(first))
  })

  it('reads only rows without a recorded length, in key order, after the cursor', async () => {
    harness.queueResult([])

    await exportImages({ database: fakeDatabase, store: createMemoryBlobStore(), batchSize: 7 })

    const select = harness.queries.find((query) => query.root === 'select')!
    const where = renderedWhere(select)
    expect(where).toContain('"image"."byte_size" is null')
    expect(where).toContain('"image"."image_hash" > $')
    expect(stepOf(select, 'orderBy')).toBeDefined()
    expect(stepOf(select, 'limit')?.args).toEqual([7])
  })

  it('resumes from the last key of each batch, so a stuck row cannot be read twice in one run', async () => {
    const store = createMemoryBlobStore()
    harness.queueResult([
      { imageHash: 'hash-a', content: first },
      { imageHash: 'hash-b', content: second },
    ])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([]) // hash-b was changed under us: nothing to mark
    harness.queueResult([]) // end

    const summary = await exportImages({ database: fakeDatabase, store, batchSize: 2 })

    expect(summary).toMatchObject({ examined: 2, exported: 1, skipped: 1 })
    const selects = harness.queries.filter((query) => query.root === 'select')
    expect(sqlParams(stepOf(selects[0], 'where')?.args[0])).toContain('')
    expect(sqlParams(stepOf(selects[1], 'where')?.args[0])).toContain('hash-b')
  })

  it('marks a link-only row with length 0, writing no file and recording no digest', async () => {
    const store = createMemoryBlobStore()
    harness.queueResult([
      { imageHash: 'hash-link', content: Buffer.alloc(0) },
      { imageHash: 'hash-null', content: null },
    ])
    harness.queueResult([{ imageHash: 'hash-link' }])
    harness.queueResult([{ imageHash: 'hash-null' }])
    harness.queueResult([])

    const summary = await exportImages({ database: fakeDatabase, store })

    expect(summary).toEqual({ examined: 2, exported: 0, empty: 2, skipped: 0, bytes: 0 })
    expect(store.puts).toEqual([])
    const updates = harness.queries.filter((query) => query.root === 'update')
    expect(stepOf(updates[0], 'set')?.args[0]).toEqual({ byteSize: 0 })
    expect(renderedWhere(updates[0])).toContain('"image"."byte_size" is null')
    expect(renderedWhere(updates[0])).toContain('octet_length("image"."content") = 0')
  })

  it('skips a link-only row that another writer filled in between the read and the mark', async () => {
    harness.queueResult([{ imageHash: 'hash-link', content: Buffer.alloc(0) }])
    harness.queueResult([])
    harness.queueResult([])

    const summary = await exportImages({ database: fakeDatabase, store: createMemoryBlobStore() })

    expect(summary).toMatchObject({ empty: 0, skipped: 1 })
  })

  it('stores identical bytes under two rows once, and marks both', async () => {
    const store = createMemoryBlobStore()
    harness.queueResult([
      { imageHash: 'hash-a', content: first },
      { imageHash: 'hash-b', content: first },
    ])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([{ imageHash: 'hash-b' }])
    harness.queueResult([])

    const summary = await exportImages({ database: fakeDatabase, store })

    expect(summary.exported).toBe(2)
    expect(store.blobs.size).toBe(1)
  })

  it('pauses between batches by the requested time, and not at all by default', async () => {
    const sleep = vi.fn(async () => undefined)
    harness.queueResult([{ imageHash: 'hash-a', content: first }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    await exportImages({ database: fakeDatabase, store: createMemoryBlobStore(), sleep, sleepMs: 250 })
    expect(sleep).toHaveBeenCalledExactlyOnceWith(250)

    sleep.mockClear()
    harness.reset()
    harness.queueResult([{ imageHash: 'hash-a', content: first }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    await exportImages({ database: fakeDatabase, store: createMemoryBlobStore(), sleep })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('waits on a real timer when the pause is requested and no clock is injected', async () => {
    harness.queueResult([{ imageHash: 'hash-a', content: first }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    const summary = await exportImages({ database: fakeDatabase, store: createMemoryBlobStore(), sleepMs: 1 })

    expect(summary.exported).toBe(1)
  })

  it('uses the process database and store when none are passed', async () => {
    harness.queueResult([])

    const summary = await exportImages({ store: createMemoryBlobStore() })

    expect(summary.examined).toBe(0)
  })

  it('does not mark a row whose file could not be written', async () => {
    const store = createMemoryBlobStore()
    store.put = async () => {
      throw new Error('disk full')
    }
    harness.queueResult([{ imageHash: 'hash-a', content: first }])

    await expect(exportImages({ database: fakeDatabase, store })).rejects.toThrow('disk full')

    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
  })

  it('has no work to do on a second run when the first finished', async () => {
    harness.queueResult([])

    expect(await exportImages({ database: fakeDatabase, store: createMemoryBlobStore() })).toEqual({
      examined: 0,
      exported: 0,
      empty: 0,
      skipped: 0,
      bytes: 0,
    })
  })
})

describe('verifyImages', () => {
  const sha = hashBytes(first)

  /** Queues the answers of the three row-level queries, then the file pages. */
  const queueRowChecks = ({
    pending = 0,
    inconsistent = { total: 0, examples: null as string[] | null },
    mismatch = { total: 0, examples: null as string[] | null },
  } = {}) => {
    harness.queueResult({ rows: [{ total: pending }] })
    harness.queueResult({ rows: [inconsistent] })
    harness.queueResult({ rows: [mismatch] })
  }

  it('is ok when nothing is pending, nothing disagrees, and every named file is present at the recorded length', async () => {
    const store = createMemoryBlobStore()
    await store.put(first)
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length }] })
    harness.queueResult({ rows: [] })

    const summary = await verifyImages({ database: fakeDatabase, store })

    expect(summary).toEqual({
      pendingRows: 0,
      inconsistentRows: 0,
      databaseMismatchRows: 0,
      filesChecked: 1,
      missingFiles: [],
      wrongSizeFiles: [],
      wrongDigestFiles: [],
      examples: { inconsistent: [], databaseMismatch: [] },
      ok: true,
    })
  })

  it('compares the digest inside Postgres, for rows that still carry bytes', async () => {
    queueRowChecks()
    harness.queueResult({ rows: [] })

    await verifyImages({ database: fakeDatabase, store: createMemoryBlobStore() })

    const executed = harness.queries.filter((query) => query.root === 'execute')
    const rendered = executed.map((query) => renderSql(query.steps[0].args[0]))
    expect(rendered[0]).toContain('"image"."byte_size" IS NULL')
    expect(rendered[2]).toContain(`encode(sha256("image"."content"), 'hex') IS DISTINCT FROM "image"."content_sha256"`)
    expect(rendered[2]).toContain('octet_length("image"."content") IS DISTINCT FROM "image"."byte_size"')
    expect(rendered[2]).toContain('"image"."content" IS NOT NULL')
  })

  it('reports rows whose bytes in the database do not hash to their digest, with examples, and is not ok', async () => {
    queueRowChecks({ mismatch: { total: 3, examples: ['hash-1', 'hash-2', 'hash-3'] } })
    harness.queueResult({ rows: [] })

    const summary = await verifyImages({ database: fakeDatabase, store: createMemoryBlobStore() })

    expect(summary.databaseMismatchRows).toBe(3)
    expect(summary.examples.databaseMismatch).toEqual(['hash-1', 'hash-2', 'hash-3'])
    expect(summary.ok).toBe(false)
  })

  it('reports rows left unexported, and rows with half a description, and is not ok for either', async () => {
    queueRowChecks({ pending: 4 })
    harness.queueResult({ rows: [] })
    expect((await verifyImages({ database: fakeDatabase, store: createMemoryBlobStore() })).ok).toBe(false)

    harness.reset()
    queueRowChecks({ inconsistent: { total: 1, examples: ['hash-x'] } })
    harness.queueResult({ rows: [] })
    const summary = await verifyImages({ database: fakeDatabase, store: createMemoryBlobStore() })
    expect(summary).toMatchObject({ inconsistentRows: 1, ok: false })
    expect(summary.examples.inconsistent).toEqual(['hash-x'])
  })

  it('reports a digest with no file', async () => {
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length }] })
    harness.queueResult({ rows: [] })

    const summary = await verifyImages({ database: fakeDatabase, store: createMemoryBlobStore() })

    expect(summary.missingFiles).toEqual([sha])
    expect(summary.ok).toBe(false)
  })

  it('reports a file that is not the recorded length', async () => {
    const store = createMemoryBlobStore()
    await store.put(first)
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length + 1 }] })
    harness.queueResult({ rows: [] })

    const summary = await verifyImages({ database: fakeDatabase, store })

    expect(summary.wrongSizeFiles).toEqual([sha])
    expect(summary.ok).toBe(false)
  })

  it('trusts a file of the right name and length unless asked to rehash, and catches a corrupted one when asked', async () => {
    const store = createMemoryBlobStore()
    await store.put(first)
    // Same name, same length, different bytes: what a bad disk or a bad copy produces.
    store.blobs.get(sha)!.bytes = Buffer.from('X'.repeat(first.length))

    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length }] })
    harness.queueResult({ rows: [] })
    expect((await verifyImages({ database: fakeDatabase, store })).ok).toBe(true)

    harness.reset()
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length }] })
    harness.queueResult({ rows: [] })
    const rehashed = await verifyImages({ database: fakeDatabase, store, rehash: true })
    expect(rehashed.wrongDigestFiles).toEqual([sha])
    expect(rehashed.ok).toBe(false)
  })

  it('counts a file that disappears during a rehash as wrong', async () => {
    const store = createMemoryBlobStore()
    await store.put(first)
    store.get = async () => null
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length }] })
    harness.queueResult({ rows: [] })

    expect((await verifyImages({ database: fakeDatabase, store, rehash: true })).wrongDigestFiles).toEqual([sha])
  })

  it('accepts a good file under rehash', async () => {
    const store = createMemoryBlobStore()
    await store.put(first)
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: sha, byteSize: first.length }] })
    harness.queueResult({ rows: [] })

    expect((await verifyImages({ database: fakeDatabase, store, rehash: true })).ok).toBe(true)
  })

  it('walks the digests a page at a time, resuming after the last one it saw', async () => {
    const store = createMemoryBlobStore()
    const one = await store.put(first)
    const two = await store.put(second)
    queueRowChecks()
    harness.queueResult({ rows: [{ sha256: one.sha256, byteSize: one.byteSize }] })
    harness.queueResult({ rows: [{ sha256: two.sha256, byteSize: two.byteSize }] })
    harness.queueResult({ rows: [] })

    const summary = await verifyImages({ database: fakeDatabase, store, pageSize: 1 })

    expect(summary.filesChecked).toBe(2)
    const pages = harness.queries.filter((query) => query.root === 'execute').slice(3)
    expect(sqlParams(pages[1].steps[0].args[0])).toContain(one.sha256)
    expect(sqlParams(pages[0].steps[0].args[0])).toContain('')
  })

  it('lists no more than the example limit of each kind of missing file, but counts them all', async () => {
    queueRowChecks()
    const many = Array.from({ length: EXAMPLE_LIMIT + 5 }, (_, index) => ({
      sha256: index.toString(16).padStart(64, '0'),
      byteSize: 1,
    }))
    harness.queueResult({ rows: many })
    harness.queueResult({ rows: [] })

    const summary = await verifyImages({ database: fakeDatabase, store: createMemoryBlobStore() })

    expect(summary.filesChecked).toBe(EXAMPLE_LIMIT + 5)
    expect(summary.missingFiles).toHaveLength(EXAMPLE_LIMIT)
    expect(summary.ok).toBe(false)
  })

  it('uses the process database and store when none are passed', async () => {
    queueRowChecks()
    harness.queueResult({ rows: [] })

    expect((await verifyImages({ store: createMemoryBlobStore() })).ok).toBe(true)
  })
})

describe('importImages', () => {
  it('restores bytes only into rows whose content is still empty and whose digest is still the one read', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(first)
    harness.queueResult([{ imageHash: 'hash-a', contentSha256: sha256 }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    const summary = await importImages({ database: fakeDatabase, store })

    expect(summary).toEqual({ examined: 1, restored: 1, missingFiles: 0, skipped: 0 })
    const update = harness.queries.find((query) => query.root === 'update')!
    expect(stepOf(update, 'set')?.args[0]).toEqual({ content: first })
    expect(renderedWhere(update)).toContain('"image"."content" is null')
    expect(renderedWhere(update)).toContain('"image"."content_sha256" = $')
    expect(sqlParams(stepOf(update, 'where')?.args[0])).toContain(sha256)
  })

  it('selects rows that have a recorded length above zero and no bytes', async () => {
    harness.queueResult([])

    await importImages({ database: fakeDatabase, store: createMemoryBlobStore(), batchSize: 9 })

    const select = harness.queries.find((query) => query.root === 'select')!
    const where = renderedWhere(select)
    expect(where).toContain('"image"."content" is null')
    expect(where).toContain('"image"."byte_size" > $')
    expect(stepOf(select, 'limit')?.args).toEqual([9])
  })

  it('leaves a row alone when its file is missing, and moves past it', async () => {
    const store = createMemoryBlobStore()
    harness.queueResult([{ imageHash: 'hash-a', contentSha256: 'a'.repeat(64) }])
    harness.queueResult([])

    const summary = await importImages({ database: fakeDatabase, store })

    expect(summary).toMatchObject({ examined: 1, restored: 0, missingFiles: 1 })
    expect(harness.queries.filter((query) => query.root === 'update')).toHaveLength(0)
    expect(harness.queries.filter((query) => query.root === 'select')).toHaveLength(2)
  })

  it('counts a row that was written by someone else meanwhile as skipped', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(first)
    harness.queueResult([{ imageHash: 'hash-a', contentSha256: sha256 }])
    harness.queueResult([])
    harness.queueResult([])

    expect(await importImages({ database: fakeDatabase, store })).toMatchObject({ restored: 0, skipped: 1 })
  })

  it('pauses between batches when asked', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(first)
    const sleep = vi.fn(async () => undefined)
    harness.queueResult([{ imageHash: 'hash-a', contentSha256: sha256 }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    await importImages({ database: fakeDatabase, store, sleep, sleepMs: 40 })

    expect(sleep).toHaveBeenCalledExactlyOnceWith(40)
  })

  it('waits on a real timer when a pause is requested and no clock is injected', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(first)
    harness.queueResult([{ imageHash: 'hash-a', contentSha256: sha256 }])
    harness.queueResult([{ imageHash: 'hash-a' }])
    harness.queueResult([])

    expect((await importImages({ database: fakeDatabase, store, sleepMs: 1 })).restored).toBe(1)
  })

  it('uses the process database and store when none are passed', async () => {
    harness.queueResult([])

    expect((await importImages({ store: createMemoryBlobStore() })).examined).toBe(0)
  })
})
