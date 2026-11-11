/**
 * @module image-store/cid-index
 * The map from a blob's sha256 to its IPFS content identifier.
 *
 * Why a table. The store names a blob by the sha256 of its bytes. IPFS names content by a CID,
 * which is a hash of how the bytes were split into blocks and wrapped, not of the bytes alone.
 * For a file small enough to be one block, added as CIDv1 with raw leaves, the CID is the sha256
 * wrapped in a few header bytes and could be computed. For a larger file it is a different hash
 * of a tree, and no computation leads back. A pinning service also chooses its own block size.
 * So the mapping is recorded when the blob is added, and read when it is fetched.
 *
 * The same table answers `stat` and `list`, which IPFS cannot: a CID does not carry the length
 * of the blob or the time it was last written or reused (`images gc` goes by that time).
 *
 * The table is `image_store_cid` (migration 0023). The database, not the pinning service's own
 * metadata, holds it for three reasons: every pinning service lists its pins differently, a
 * listing by name would need every pin to carry the sha256 as metadata and no service lets a
 * name be searched cheaply, and the image rows that point at blobs are in this database too,
 * so one backup covers both.
 */
import { asc, eq, gt } from 'drizzle-orm'
import { getDrizzle, type DrizzleDB } from '../db/drizzle'
import * as s from '../db/schema'

/** What the index records about one blob. */
export type CidRecord = {
  /** The blob's name in the store. */
  sha256: string
  /** The IPFS content identifier of the pinned bytes. */
  cid: string
  byteSize: number
  /** When the blob was last written or reused, in milliseconds since the epoch. */
  modifiedAtMs: number
}

/** Storage for {@link CidRecord}s. */
export interface BlobCidIndex {
  /** The record for a blob, or null when none was written. */
  get(sha256: string): Promise<CidRecord | null>
  /** Writes a record, replacing one with the same digest. */
  put(record: CidRecord): Promise<void>
  /** Removes a record. Returns true when there was one. */
  remove(sha256: string): Promise<boolean>
  /** Walks every record, in digest order. */
  list(): AsyncIterable<CidRecord>
}

/** How many records one page of {@link BlobCidIndex.list} reads. */
export const CID_INDEX_PAGE_SIZE = 1000

/** Settings for {@link createDatabaseCidIndex}. */
export type DatabaseCidIndexOptions = {
  /** Defaults to the process's database. */
  database?: Pick<DrizzleDB, 'select' | 'insert' | 'delete'>
  /** Records per page when listing. Defaults to {@link CID_INDEX_PAGE_SIZE}. */
  pageSize?: number
}

const toRecord = (row: typeof s.imageStoreCid.$inferSelect): CidRecord => ({
  sha256: row.sha256,
  cid: row.cid,
  byteSize: row.byteSize,
  modifiedAtMs: row.modifiedAt.getTime(),
})

/**
 * Builds the index on the `image_store_cid` table.
 *
 * @param options See {@link DatabaseCidIndexOptions}.
 * @returns The index.
 */
export function createDatabaseCidIndex(options: DatabaseCidIndexOptions = {}): BlobCidIndex {
  const { pageSize = CID_INDEX_PAGE_SIZE } = options
  const database = () => options.database ?? getDrizzle()

  const get = async (sha256: string): Promise<CidRecord | null> => {
    const rows = await database().select().from(s.imageStoreCid).where(eq(s.imageStoreCid.sha256, sha256)).limit(1)
    return rows.length === 0 ? null : toRecord(rows[0])
  }

  const put = async (record: CidRecord): Promise<void> => {
    const values = { cid: record.cid, byteSize: record.byteSize, modifiedAt: new Date(record.modifiedAtMs) }
    await database()
      .insert(s.imageStoreCid)
      .values({ sha256: record.sha256, ...values })
      .onConflictDoUpdate({ target: s.imageStoreCid.sha256, set: values })
  }

  const remove = async (sha256: string): Promise<boolean> => {
    const removed = await database()
      .delete(s.imageStoreCid)
      .where(eq(s.imageStoreCid.sha256, sha256))
      .returning({ sha256: s.imageStoreCid.sha256 })
    return removed.length > 0
  }

  async function* list(): AsyncGenerator<CidRecord, void, undefined> {
    let cursor = ''
    for (;;) {
      const rows = await database()
        .select()
        .from(s.imageStoreCid)
        .where(gt(s.imageStoreCid.sha256, cursor))
        .orderBy(asc(s.imageStoreCid.sha256))
        .limit(pageSize)
      for (const row of rows) yield toRecord(row)
      if (rows.length < pageSize) return
      cursor = rows[rows.length - 1].sha256
    }
  }

  return { get, put, remove, list }
}
