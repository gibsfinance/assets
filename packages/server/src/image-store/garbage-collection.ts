/**
 * @module image-store/garbage-collection
 * Removes files from the image store that no `image` row points at.
 *
 * A file is written before the row that names it commits, so a rollback, a crash, or a row that
 * is later deleted or re-pointed (a re-collected image whose bytes changed, a purged
 * placeholder) leaves a file behind. Nothing else removes it.
 */
import { and, asc, gt, isNotNull, sql as dsql } from 'drizzle-orm'
import { getDrizzle, type DrizzleDB } from '../db/drizzle'
import * as s from '../db/schema'
import { log } from '../logger'
import { getImageStore, type BlobStore } from './index'

/** Seven days, in milliseconds: a file younger than this is never removed. */
export const DEFAULT_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000

/** How many digests one page of the referenced set reads. */
const REFERENCED_PAGE_SIZE = 10_000

/** Options for {@link collectGarbage}. */
export type GarbageCollectionOptions = {
  /**
   * Report what would be removed and remove nothing. Defaults to true: deleting is opt-in, and
   * the command line asks for it with `--delete`.
   */
  dryRun?: boolean
  /** A file whose last write or reuse is more recent than this many milliseconds is kept. Defaults to seven days. */
  gracePeriodMs?: number
  database?: Pick<DrizzleDB, 'selectDistinct' | 'execute'>
  store?: BlobStore
  /** Clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number
}

/** What {@link collectGarbage} found. */
export type GarbageCollectionSummary = {
  /** True when nothing was removed because the run was a dry run. */
  dryRun: boolean
  /** Files in the store. */
  scanned: number
  /** Files some row points at. */
  referenced: number
  /** Unreferenced files kept because they are younger than the grace period. */
  tooRecent: number
  /** Unreferenced files older than the grace period: removed, or, in a dry run, removable. */
  unreferenced: number
  /** Files removed. Always 0 in a dry run. */
  deleted: number
  /** Total length of the unreferenced old files. */
  unreferencedBytes: number
}

/**
 * Reads every digest the `image` table names into a set, a page at a time, in digest order.
 * The set is the only thing held in memory: about a hundred bytes per distinct image.
 */
async function readReferencedDigests(
  database: NonNullable<GarbageCollectionOptions['database']>,
): Promise<Set<string>> {
  const referenced = new Set<string>()
  let cursor = ''
  for (;;) {
    const rows = await database
      .selectDistinct({ sha256: s.image.contentSha256 })
      .from(s.image)
      .where(and(isNotNull(s.image.contentSha256), gt(s.image.contentSha256, cursor)))
      .orderBy(asc(s.image.contentSha256))
      .limit(REFERENCED_PAGE_SIZE)
    if (rows.length === 0) return referenced
    for (const row of rows) referenced.add(row.sha256 as string)
    cursor = rows[rows.length - 1].sha256 as string
  }
}

/**
 * Whether any row names this digest right now. The last check before a file is removed, so a row
 * committed after the referenced set was read still protects its file.
 */
async function isReferencedNow(
  database: NonNullable<GarbageCollectionOptions['database']>,
  sha256: string,
): Promise<boolean> {
  const { rows } = await database.execute<{ found: number }>(
    dsql`SELECT 1 AS found FROM ${s.image} WHERE ${s.image.contentSha256} = ${sha256} LIMIT 1`,
  )
  return rows.length > 0
}

/**
 * Finds the files in the store that no row names, and removes those older than the grace period.
 *
 * Three things keep a live image from being removed:
 *  - the set of digests the table names is read first, and a file in it is never a candidate;
 *  - the grace period spares a file written by a transaction that has not committed yet (the
 *    store is written before its row), and `put` renews the age of a file it reuses;
 *  - each candidate is looked up in the table once more just before it is removed.
 *
 * A dry run changes nothing, and is the default.
 *
 * @param options See {@link GarbageCollectionOptions}.
 */
export async function collectGarbage(options: GarbageCollectionOptions = {}): Promise<GarbageCollectionSummary> {
  const {
    dryRun = true,
    gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
    database = getDrizzle(),
    store = getImageStore(),
    now = Date.now,
  } = options
  const oldestKept = now() - gracePeriodMs
  const referencedDigests = await readReferencedDigests(database)
  const summary: GarbageCollectionSummary = {
    dryRun,
    scanned: 0,
    referenced: 0,
    tooRecent: 0,
    unreferenced: 0,
    deleted: 0,
    unreferencedBytes: 0,
  }
  for await (const blob of store.list()) {
    summary.scanned += 1
    if (referencedDigests.has(blob.sha256)) {
      summary.referenced += 1
      continue
    }
    // A blob with no recorded age cannot be shown to be old enough, so it stays.
    if (blob.modifiedAtMs === undefined || blob.modifiedAtMs > oldestKept) {
      summary.tooRecent += 1
      continue
    }
    if (dryRun) {
      summary.unreferenced += 1
      summary.unreferencedBytes += blob.byteSize
      continue
    }
    if (await isReferencedNow(database, blob.sha256)) {
      summary.referenced += 1
      continue
    }
    summary.unreferenced += 1
    summary.unreferencedBytes += blob.byteSize
    if (await store.delete(blob.sha256)) summary.deleted += 1
  }
  log('images gc: %o', summary)
  return summary
}
