import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from '../db/__testing__/drizzle-harness'
import { createMemoryBlobStore } from './__testing__/memory-store'
import { collectGarbage, DEFAULT_GRACE_PERIOD_MS } from './garbage-collection'

const harness = createDrizzleHarness()
/** The harness stands in for the Drizzle handle; its chain types are looser than the real ones. */
const fakeDatabase = harness.db as never
vi.mock('../logger', () => ({ log: vi.fn() }))
vi.mock('../db/drizzle', () => ({ getDrizzle: () => harness.db }))

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

beforeEach(() => {
  harness.reset()
})

/** A store holding one blob per name, each last written `ageDays` before NOW. */
const storeWith = async (blobs: Record<string, number>) => {
  const store = createMemoryBlobStore()
  const digests: Record<string, string> = {}
  for (const [name, ageDays] of Object.entries(blobs)) {
    store.setNow(NOW - ageDays * DAY)
    digests[name] = (await store.put(Buffer.from(name))).sha256
  }
  return { store, digests }
}

/**
 * Queues the pages of referenced digests, then the empty page that ends the read. A final page
 * that is already empty is that page: `queueReferenced([])` means no row names any file.
 */
const queueReferenced = (...pages: string[][]) => {
  for (const page of pages) harness.queueResult(page.map((sha256) => ({ sha256 })))
  if (pages[pages.length - 1].length > 0) harness.queueResult([])
}

describe('collectGarbage', () => {
  it('keeps every file a row names, however old', async () => {
    const { store, digests } = await storeWith({ referenced: 400 })
    queueReferenced([digests.referenced])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, dryRun: false })

    expect(summary).toMatchObject({ scanned: 1, referenced: 1, unreferenced: 0, deleted: 0 })
    expect(store.blobs.size).toBe(1)
  })

  it('deletes a file no row names once it is older than the grace period', async () => {
    const { store, digests } = await storeWith({ keep: 30, orphan: 30 })
    queueReferenced([digests.keep])
    harness.queueResult({ rows: [] }) // the last look before deleting: still nothing names it

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, dryRun: false })

    expect(summary).toEqual({
      dryRun: false,
      scanned: 2,
      referenced: 1,
      tooRecent: 0,
      unreferenced: 1,
      deleted: 1,
      unreferencedBytes: Buffer.from('orphan').length,
    })
    expect([...store.blobs.keys()]).toEqual([digests.keep])
  })

  it('keeps an unreferenced file younger than the grace period, which a transaction yet to commit may be about to name', async () => {
    const { store } = await storeWith({ fresh: 2 })
    queueReferenced([])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, dryRun: false })

    expect(summary).toMatchObject({ tooRecent: 1, unreferenced: 0, deleted: 0 })
    expect(store.blobs.size).toBe(1)
  })

  it('treats a file exactly as old as the grace period as old enough, and one a millisecond younger as not', async () => {
    const store = createMemoryBlobStore()
    store.setNow(NOW - DEFAULT_GRACE_PERIOD_MS)
    await store.put(Buffer.from('on the line'))
    store.setNow(NOW - DEFAULT_GRACE_PERIOD_MS + 1)
    await store.put(Buffer.from('just inside'))
    queueReferenced([])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW })

    expect(summary).toMatchObject({ unreferenced: 1, tooRecent: 1 })
  })

  it('removes nothing in a dry run, which is the default, and reports what it would remove', async () => {
    const { store } = await storeWith({ orphan: 30 })
    queueReferenced([])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW })

    expect(summary).toMatchObject({ dryRun: true, unreferenced: 1, deleted: 0, unreferencedBytes: 6 })
    expect(store.blobs.size).toBe(1)
    // Only the read of referenced digests touched the database: no per-file look, no delete.
    expect(harness.queries.filter((query) => query.root === 'execute')).toHaveLength(0)
  })

  it('honours a grace period the caller sets', async () => {
    const { store } = await storeWith({ orphan: 2 })
    queueReferenced([])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, gracePeriodMs: DAY })

    expect(summary.unreferenced).toBe(1)
  })

  it('looks once more before deleting, and keeps a file a row has named since the set was read', async () => {
    const { store } = await storeWith({ late: 30 })
    queueReferenced([])
    harness.queueResult({ rows: [{ found: 1 }] })

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, dryRun: false })

    expect(summary).toMatchObject({ referenced: 1, unreferenced: 0, deleted: 0 })
    expect(store.blobs.size).toBe(1)
    const lookup = harness.queries.find((query) => query.root === 'execute')!.steps[0].args[0]
    expect(renderSql(lookup)).toContain('WHERE "image"."content_sha256" = $1 LIMIT 1')
    expect(sqlParams(lookup)).toEqual([[...store.blobs.keys()][0]])
  })

  it('keeps a file whose age the store cannot tell', async () => {
    const store = createMemoryBlobStore()
    store.list = async function* () {
      yield { sha256: 'a'.repeat(64), byteSize: 3 }
    }
    queueReferenced([])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, dryRun: false })

    expect(summary).toMatchObject({ tooRecent: 1, deleted: 0 })
  })

  it('does not count a file as deleted when another process removed it first', async () => {
    const { store } = await storeWith({ orphan: 30 })
    store.delete = async () => false
    queueReferenced([])
    harness.queueResult({ rows: [] })

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW, dryRun: false })

    expect(summary).toMatchObject({ unreferenced: 1, deleted: 0 })
  })

  it('reads the referenced digests a page at a time, resuming after the last digest of each page', async () => {
    const { store, digests } = await storeWith({ one: 30, two: 30 })
    queueReferenced([digests.one], [digests.two])

    const summary = await collectGarbage({ database: fakeDatabase, store, now: () => NOW })

    expect(summary.referenced).toBe(2)
    const selects = harness.queries.filter((query) => query.root === 'selectDistinct')
    expect(selects).toHaveLength(3)
    const where = (index: number) => selects[index].steps.find((step) => step.method === 'where')?.args[0]
    expect(sqlParams(where(0))).toContain('')
    expect(sqlParams(where(1))).toContain(digests.one)
    expect(sqlParams(where(2))).toContain(digests.two)
    expect(renderSql(where(0))).toContain('"image"."content_sha256" is not null')
  })

  it('has nothing to do for an empty store', async () => {
    queueReferenced([])

    expect(await collectGarbage({ database: fakeDatabase, store: createMemoryBlobStore() })).toMatchObject({
      scanned: 0,
      deleted: 0,
    })
  })

  it('uses the process database, store and clock when none are passed', async () => {
    queueReferenced([])

    // The process store is the real one, aimed at the default directory; a dry run only reads it.
    const summary = await collectGarbage({})

    expect(summary.dryRun).toBe(true)
  })
})
