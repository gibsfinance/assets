import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleHarness, renderSql, sqlParams } from '../db/__testing__/drizzle-harness'
import { createDatabaseCidIndex, CID_INDEX_PAGE_SIZE } from './cid-index'

const harness = createDrizzleHarness()
vi.mock('../db/drizzle', () => ({ getDrizzle: () => harness.db }))

beforeEach(() => {
  harness.reset()
})

const SHA = 'ab'.repeat(32)
const row = (sha256: string, modifiedAt = new Date(5000)) => ({
  sha256,
  cid: `cid-of-${sha256.slice(0, 2)}`,
  byteSize: 7,
  modifiedAt,
})

describe('createDatabaseCidIndex', () => {
  it('reads one record by digest, with its time as milliseconds', async () => {
    harness.queueResult([row(SHA)])

    const record = await createDatabaseCidIndex().get(SHA)

    expect(record).toEqual({ sha256: SHA, cid: 'cid-of-ab', byteSize: 7, modifiedAtMs: 5000 })
    const where = harness.queries[0].steps.find((step) => step.method === 'where')
    expect(sqlParams(where?.args[0])).toEqual([SHA])
  })

  it('answers null for a digest with no row', async () => {
    harness.queueResult([])

    expect(await createDatabaseCidIndex().get(SHA)).toBeNull()
  })

  it('writes a record, and on a repeat replaces the cid, length and time but not the digest', async () => {
    harness.queueResult(undefined)

    await createDatabaseCidIndex().put({ sha256: SHA, cid: 'cid-1', byteSize: 9, modifiedAtMs: 7000 })

    const steps = harness.queries[0].steps
    expect(steps.find((step) => step.method === 'values')?.args[0]).toEqual({
      sha256: SHA,
      cid: 'cid-1',
      byteSize: 9,
      modifiedAt: new Date(7000),
    })
    const conflict = steps.find((step) => step.method === 'onConflictDoUpdate')?.args[0] as { set: object }
    expect(conflict.set).toEqual({ cid: 'cid-1', byteSize: 9, modifiedAt: new Date(7000) })
  })

  it('says whether a delete removed a row', async () => {
    harness.queueResult([{ sha256: SHA }])
    harness.queueResult([])

    expect(await createDatabaseCidIndex().remove(SHA)).toBe(true)
    expect(await createDatabaseCidIndex().remove(SHA)).toBe(false)
  })

  it('lists in digest order, a page at a time, continuing after the last digest of each page', async () => {
    harness.queueResult([row('01'.repeat(32)), row('02'.repeat(32))])
    harness.queueResult([row('03'.repeat(32))])

    const listed: string[] = []
    for await (const record of createDatabaseCidIndex({ pageSize: 2 }).list()) listed.push(record.sha256.slice(0, 2))

    expect(listed).toEqual(['01', '02', '03'])
    const cursors = harness.queries.map((query) =>
      sqlParams(query.steps.find((step) => step.method === 'where')?.args[0]),
    )
    expect(cursors).toEqual([[''], ['02'.repeat(32)]])
    expect(renderSql(harness.queries[0].steps.find((step) => step.method === 'where')?.args[0])).toContain('>')
  })

  it('stops after one query when the first page is short, and lists nothing for an empty table', async () => {
    harness.queueResult([])

    const listed = []
    for await (const record of createDatabaseCidIndex().list()) listed.push(record)

    expect(listed).toEqual([])
    expect(harness.queries).toHaveLength(1)
    expect(CID_INDEX_PAGE_SIZE).toBe(1000)
  })

  it('uses the database it is given instead of the process one', async () => {
    const other = createDrizzleHarness()
    other.queueResult([row(SHA)])

    await createDatabaseCidIndex({ database: other.db as never }).get(SHA)

    expect(other.queries).toHaveLength(1)
    expect(harness.queries).toHaveLength(0)
  })
})
