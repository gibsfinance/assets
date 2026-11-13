import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from '../db/__testing__/drizzle-harness'
import { createMemoryBlobStore } from './__testing__/memory-store'
import { EXAMPLE_LIMIT } from './backfill'
import { hashBytes } from './hash'
import { resanitizeImages } from './resanitize'
import { sanitizeSvgDocument } from '../svg-sanitize'

const harness = createDrizzleHarness()
const fakeDatabase = harness.db as never
const defaultStore = createMemoryBlobStore()
vi.mock('../logger', () => ({ log: vi.fn() }))
vi.mock('../db/drizzle', () => ({ getDrizzle: () => harness.db }))
vi.mock('./index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./index')>()),
  getImageStore: () => defaultStore,
}))

const NS = 'xmlns="http://www.w3.org/2000/svg"'
/** Markup an older sanitizer left in place: a comment, and a script in a prefixed element. */
const old = Buffer.from(
  `<svg ${NS} xmlns:s="http://www.w3.org/2000/svg"><!-- c --><s:script>alert(1)</s:script><rect/></svg>`,
)
const cleaned = sanitizeSvgDocument(old)
const alreadyClean = cleaned

const stepOf = (query: (typeof harness.queries)[number], method: string) =>
  query.steps.find((step) => step.method === method)
const renderedWhere = (query: (typeof harness.queries)[number]) => renderSql(stepOf(query, 'where')?.args[0])

beforeEach(() => {
  harness.reset()
  defaultStore.blobs.clear()
  defaultStore.puts.length = 0
})

describe('resanitizeImages', () => {
  it('is a dry run by default: it reports what would change and writes nothing', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(old)
    store.puts.length = 0
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store })

    expect(summary).toMatchObject({ dryRun: true, examined: 1, changed: 1, rewritten: 0, unchanged: 0, ok: true })
    expect(store.puts).toEqual([])
    expect(harness.queries.some((query) => query.root === 'update')).toBe(false)
  })

  it('writes the new file before moving the row, and records the digest and length of the new bytes', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(old)
    const filesWhenUpdated: number[] = []
    const database = {
      ...harness.db,
      update: (...args: Parameters<typeof harness.db.update>) => {
        filesWhenUpdated.push(store.blobs.size)
        return harness.db.update(...args)
      },
    } as never
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([{ imageHash: 'a' }])
    harness.queueResult([])

    const summary = await resanitizeImages({ database, store, dryRun: false })

    expect(filesWhenUpdated).toEqual([2])
    expect(summary).toMatchObject({ changed: 1, rewritten: 1, skipped: 0, ok: true })
    const update = harness.queries.find((query) => query.root === 'update')!
    expect(stepOf(update, 'set')?.args[0]).toEqual({ contentSha256: hashBytes(cleaned), byteSize: cleaned.length })
    // The address of the image is never touched, and only the row that was read is changed.
    expect(renderedWhere(update)).toContain('"image"."image_hash" = $')
    expect(renderedWhere(update)).toContain('"image"."content_sha256" = $')
    expect(sqlParams(stepOf(update, 'where')?.args[0])).toEqual(['a', sha256])
  })

  it('never deletes a file: the old one stays for the garbage collector', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(old)
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([{ imageHash: 'a' }])
    harness.queueResult([])

    await resanitizeImages({ database: fakeDatabase, store, dryRun: false })

    expect(store.blobs.has(sha256)).toBe(true)
    expect(store.blobs.has(hashBytes(cleaned))).toBe(true)
  })

  it('moves a copy kept in the database together with the digest, so the two always agree', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(old)
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: true }])
    harness.queueResult([{ imageHash: 'a' }])
    harness.queueResult([])

    await resanitizeImages({ database: fakeDatabase, store, dryRun: false })

    const update = harness.queries.find((query) => query.root === 'update')!
    expect(stepOf(update, 'set')?.args[0]).toEqual({
      contentSha256: hashBytes(cleaned),
      byteSize: cleaned.length,
      content: cleaned,
    })
  })

  it('handles a row not exported yet: guards on the bytes it holds and gives it a digest', async () => {
    const store = createMemoryBlobStore()
    harness.queueResult([{ imageHash: 'a', content: old, contentSha256: null, holdsDatabaseCopy: true }])
    harness.queueResult([{ imageHash: 'a' }])
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store, dryRun: false })

    expect(summary.rewritten).toBe(1)
    const update = harness.queries.find((query) => query.root === 'update')!
    expect(renderedWhere(update)).toContain('"image"."content_sha256" is null')
    expect(renderedWhere(update)).toContain('encode(sha256("image"."content"), \'hex\') = $')
    expect(sqlParams(stepOf(update, 'where')?.args[0])).toContain(hashBytes(old))
    expect(stepOf(update, 'set')?.args[0]).toMatchObject({ contentSha256: hashBytes(cleaned), content: cleaned })
  })

  it('counts a row that changed since it was read as skipped', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(old)
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store, dryRun: false })

    expect(summary).toMatchObject({ changed: 1, rewritten: 0, skipped: 1 })
  })

  it('leaves a row alone when the sanitizer would not change it, so a second run finds nothing to do', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(alreadyClean)
    store.puts.length = 0
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store, dryRun: false })

    expect(summary).toMatchObject({ examined: 1, unchanged: 1, changed: 0 })
    expect(store.puts).toEqual([])
    expect(harness.queries.some((query) => query.root === 'update')).toBe(false)
  })

  it('reports a row the sanitizer refuses, leaves it, and is not ok', async () => {
    const store = createMemoryBlobStore()
    const broken = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle></svg>')
    const { sha256 } = await store.put(broken)
    harness.queueResult([{ imageHash: 'broken', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store, dryRun: false })

    expect(summary).toMatchObject({ rejected: 1, rejectedExamples: ['broken'], ok: false, rewritten: 0 })
    expect(harness.queries.some((query) => query.root === 'update')).toBe(false)
  })

  it('lists at most a fixed number of rejected examples but counts them all', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(Buffer.from('not markup'))
    const rows = Array.from({ length: EXAMPLE_LIMIT + 3 }, (_, index) => ({
      imageHash: `h${index}`,
      content: null,
      contentSha256: sha256,
      holdsDatabaseCopy: false,
    }))
    harness.queueResult(rows)
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store })

    expect(summary.rejected).toBe(EXAMPLE_LIMIT + 3)
    expect(summary.rejectedExamples).toHaveLength(EXAMPLE_LIMIT)
  })

  it('reports a missing file, leaves the row, and is not ok', async () => {
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: 'f'.repeat(64), holdsDatabaseCopy: false }])
    harness.queueResult([])

    const summary = await resanitizeImages({ database: fakeDatabase, store: createMemoryBlobStore(), dryRun: false })

    expect(summary).toMatchObject({ missingFiles: 1, ok: false })
  })

  it('reads only vector rows that carry bytes, in key order, after the cursor, a batch at a time', async () => {
    harness.queueResult([])

    await resanitizeImages({ database: fakeDatabase, store: createMemoryBlobStore(), batchSize: 7 })

    const select = harness.queries.find((query) => query.root === 'select')!
    const where = renderedWhere(select)
    expect(where).toContain('"image"."ext" = $')
    expect(sqlParams(stepOf(select, 'where')?.args[0])).toContain('.svg')
    expect(where).toContain('"image"."image_hash" > $')
    expect(where).toContain('"image"."content_sha256" is not null')
    expect(where).toContain('octet_length')
    expect(stepOf(select, 'limit')?.args).toEqual([7])
  })

  it('resumes from the last key of each batch and pauses between batches only when asked', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(alreadyClean)
    const sleep = vi.fn(async () => undefined)
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])

    await resanitizeImages({ database: fakeDatabase, store, sleep, sleepMs: 30 })

    expect(sleep).toHaveBeenCalledExactlyOnceWith(30)
    const selects = harness.queries.filter((query) => query.root === 'select')
    expect(sqlParams(stepOf(selects[0], 'where')?.args[0])).toContain('')
    expect(sqlParams(stepOf(selects[1], 'where')?.args[0])).toContain('a')

    sleep.mockClear()
    harness.reset()
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])
    await resanitizeImages({ database: fakeDatabase, store, sleep })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('waits on a real timer by default, and uses the process store and database when none are passed', async () => {
    const { sha256 } = await defaultStore.put(alreadyClean)
    harness.queueResult([{ imageHash: 'a', content: null, contentSha256: sha256, holdsDatabaseCopy: false }])
    harness.queueResult([])

    const summary = await resanitizeImages({ sleepMs: 1 })

    expect(summary.unchanged).toBe(1)
  })
})
