/**
 * @module image-store/resanitize
 * Runs the current vector image sanitizer over the vector images already stored.
 *
 * The sanitizer runs when an image is inserted, so a row stored before a fix keeps the bytes the
 * older sanitizer produced. This operation reads each vector row, sanitizes it again, and where
 * the result differs it writes the new bytes to the image store and points the row at them.
 *
 * Properties an operator can rely on:
 * - It is a dry run unless told otherwise. A dry run reads everything and changes nothing.
 * - It never deletes a file. The old file stays in the store until `images gc` finds that no row
 *   names it and its grace period has passed.
 * - `image_hash`, the public address of an image, never changes.
 * - It is safe to stop and to run again. The sanitizer is idempotent, so a row that was rewritten is
 *   read back as unchanged on the next run, and a run that stopped part way is finished by the next.
 * - A row is changed only if it is still what was read (a guarded update), so a concurrent writer is
 *   never overwritten; such a row is counted as skipped and is picked up by the next run.
 */
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, or, sql as dsql } from 'drizzle-orm'
import { getDrizzle, type DrizzleDB } from '../db/drizzle'
import { unexportedBytesSql } from '../db/image-columns'
import * as s from '../db/schema'
import { log } from '../logger'
import { LEGACY_VECTOR_EXT } from '../image-format'
import { sanitizeSvgDocument } from '../svg-sanitize'
import { DEFAULT_BATCH_SIZE, EXAMPLE_LIMIT, type BackfillDependencies } from './backfill'
import { getImageStore, hashBytes } from './index'
import { loadImageBytes } from './image-bytes'

/** The extensions of the rows this operation looks at: `.svg`, and the older spelling some rows carry. */
const VECTOR_EXTENSIONS = ['.svg', LEGACY_VECTOR_EXT]

/** The database calls this operation makes. A row and its variants change in one transaction. */
type ResanitizeDatabase = Pick<DrizzleDB, 'select' | 'update' | 'delete' | 'execute' | 'transaction'>

/** Options for {@link resanitizeImages}. */
export type ResanitizeOptions = Omit<BackfillDependencies, 'database'> & {
  database?: ResanitizeDatabase
  /** When true (the default), report what would change and change nothing. */
  dryRun?: boolean
  /** Rows per batch. Defaults to {@link DEFAULT_BATCH_SIZE}. */
  batchSize?: number
  /** Pause between batches, in milliseconds. Defaults to 0. */
  sleepMs?: number
  /**
   * Called with the `image_hash` of each row the moment it is rewritten, so an operator's list is
   * complete even when the run stops part way.
   */
  onRewritten?: (imageHash: string) => void
}

/** What {@link resanitizeImages} did. */
export type ResanitizeSummary = {
  /** True when nothing was written. */
  dryRun: boolean
  /** Rows read. */
  examined: number
  /** Rows whose bytes the sanitizer leaves exactly as they are. */
  unchanged: number
  /** Rows whose sanitized bytes differ from the stored ones. In a dry run these are the rows that would be rewritten. */
  changed: number
  /** Rows rewritten: the new file is in the store and the row names it. Always 0 in a dry run. */
  rewritten: number
  /**
   * Resized variants (`image_variant` rows) deleted with the rows that were rewritten, so none built
   * from the old bytes is served again. In a dry run, how many would be deleted.
   */
  variantsDeleted: number
  /** Rows that changed between being read and being written, left as they were. */
  skipped: number
  /** Rows the sanitizer refuses (the bytes are not well formed). They are left as they are. */
  rejected: number
  /** Rows whose file is missing from the store. They are left as they are. */
  missingFiles: number
  /** Rows examined whose extension is the older `.svg+xml` spelling. They are sanitized like any other. */
  legacyExtensionRows: number
  /**
   * The `image_hash` of every row rewritten, in the order they were rewritten. Their addresses
   * (`/image/direct/<hash>`) may sit in edge caches, so an operator asks the cache to drop them.
   * Empty in a dry run.
   */
  rewrittenHashes: string[]
  /** Example `image_hash` values of rejected rows, at most {@link EXAMPLE_LIMIT}. */
  rejectedExamples: string[]
  /** True when no row was rejected and no file was missing. */
  ok: boolean
}

type VectorRow = {
  imageHash: string
  ext: string
  content: Buffer | null
  contentSha256: string | null
  holdsDatabaseCopy: boolean
}

/** The state of one row after it was looked at, as a key of {@link ResanitizeSummary}. */
type RowOutcome = 'unchanged' | 'changed' | 'rewritten' | 'skipped' | 'rejected' | 'missingFiles'

/**
 * Sanitizes every stored vector image again.
 *
 * @param options See {@link ResanitizeOptions}.
 * @returns Counts of what was found and done.
 */
export async function resanitizeImages(options: ResanitizeOptions = {}): Promise<ResanitizeSummary> {
  const {
    database = getDrizzle(),
    store = getImageStore(),
    sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    dryRun = true,
    batchSize = DEFAULT_BATCH_SIZE,
    sleepMs = 0,
    onRewritten = () => undefined,
  } = options
  const summary: ResanitizeSummary = {
    dryRun,
    examined: 0,
    unchanged: 0,
    changed: 0,
    rewritten: 0,
    variantsDeleted: 0,
    skipped: 0,
    rejected: 0,
    missingFiles: 0,
    legacyExtensionRows: 0,
    rewrittenHashes: [],
    rejectedExamples: [],
    ok: true,
  }
  let cursor = ''
  for (;;) {
    const rows: VectorRow[] = await database
      .select({
        imageHash: s.image.imageHash,
        ext: s.image.ext,
        content: unexportedBytesSql,
        contentSha256: s.image.contentSha256,
        holdsDatabaseCopy: dsql<boolean>`${s.image.content} IS NOT NULL`,
      })
      .from(s.image)
      .where(
        and(
          inArray(s.image.ext, VECTOR_EXTENSIONS),
          gt(s.image.imageHash, cursor),
          or(
            isNotNull(s.image.contentSha256),
            and(isNotNull(s.image.content), dsql`octet_length(${s.image.content}) > 0`),
          ),
        ),
      )
      .orderBy(asc(s.image.imageHash))
      .limit(batchSize)
    if (rows.length === 0) break
    for (const row of rows) {
      summary.examined += 1
      const { outcome, variants } = await resanitizeRow(row, { database, store, dryRun })
      summary[outcome] += 1
      summary.variantsDeleted += variants
      if (row.ext === LEGACY_VECTOR_EXT) summary.legacyExtensionRows += 1
      if (outcome === 'rewritten') {
        summary.rewrittenHashes.push(row.imageHash)
        onRewritten(row.imageHash)
      }
      // A rewritten row, or one that could not be rewritten, was one the sanitizer would change.
      if (outcome === 'rewritten' || outcome === 'skipped') summary.changed += 1
      if (outcome === 'rejected' && summary.rejectedExamples.length < EXAMPLE_LIMIT) {
        summary.rejectedExamples.push(row.imageHash)
      }
    }
    cursor = rows[rows.length - 1].imageHash
    log(
      'images resanitize: %d examined, %d changed, %d rewritten, %d rejected',
      summary.examined,
      summary.changed,
      summary.rewritten,
      summary.rejected,
    )
    if (sleepMs > 0) await sleep(sleepMs)
  }
  summary.ok = summary.rejected === 0 && summary.missingFiles === 0
  return summary
}

/** Reads, sanitizes and, unless it is a dry run, rewrites one row. */
async function resanitizeRow(
  row: VectorRow,
  {
    database,
    store,
    dryRun,
  }: {
    database: ResanitizeDatabase
    store: NonNullable<BackfillDependencies['store']>
    dryRun: boolean
  },
): Promise<RowResult> {
  const bytes = await loadImageBytes(row, store)
  if (bytes === null) return { outcome: 'missingFiles', variants: 0 }
  const cleaned = sanitizeOrNull(bytes)
  if (cleaned === null) return { outcome: 'rejected', variants: 0 }
  if (cleaned.equals(bytes)) return { outcome: 'unchanged', variants: 0 }
  if (dryRun) return { outcome: 'changed', variants: await countVariants(database, row.imageHash) }
  return rewriteRow(row, { database, store, previousSha256: hashBytes(bytes), cleaned })
}

/** What was done to one row, and how many variants went (or would go) with it. */
type RowResult = { outcome: RowOutcome; variants: number }

/** How many resized variants are stored for an image. */
async function countVariants(database: ResanitizeDatabase, imageHash: string): Promise<number> {
  const [found] = await database
    .select({ total: count() })
    .from(s.imageVariant)
    .where(eq(s.imageVariant.imageHash, imageHash))
  return Number(found?.total ?? 0)
}

/** The sanitized bytes, or null when the sanitizer refuses the document. It throws nothing else. */
function sanitizeOrNull(bytes: Buffer): Buffer | null {
  try {
    return sanitizeSvgDocument(bytes)
  } catch {
    return null
  }
}

/**
 * Writes the new file, then moves the row to it. The file goes first, so a row that names a digest
 * always has its file. The update applies only while the row still holds the bytes that were read.
 */
async function rewriteRow(
  row: VectorRow,
  {
    database,
    store,
    previousSha256,
    cleaned,
  }: {
    database: ResanitizeDatabase
    store: NonNullable<BackfillDependencies['store']>
    previousSha256: string
    cleaned: Buffer
  },
): Promise<RowResult> {
  const stored = await store.put(cleaned)
  const stillWhatWasRead =
    row.contentSha256 === null
      ? and(isNull(s.image.contentSha256), dsql`encode(sha256(${s.image.content}), 'hex') = ${previousSha256}`)
      : eq(s.image.contentSha256, row.contentSha256)
  // A copy in the database moves with the digest: the guard in the database that clears a digest
  // that no longer matches `content` compares the two inside this one statement, and they agree.
  const values = row.holdsDatabaseCopy
    ? { contentSha256: stored.sha256, byteSize: stored.byteSize, content: cleaned }
    : { contentSha256: stored.sha256, byteSize: stored.byteSize }
  // The row and its variants change in one transaction: a variant drawn from the old bytes must not
  // outlive the bytes, and a row that was not rewritten keeps the variants that still match it.
  return database.transaction(async (transaction) => {
    const updated = await transaction
      .update(s.image)
      .set(values)
      .where(and(eq(s.image.imageHash, row.imageHash), stillWhatWasRead))
      .returning({ imageHash: s.image.imageHash })
    if (updated.length === 0) return { outcome: 'skipped' as const, variants: 0 }
    const removed = await transaction
      .delete(s.imageVariant)
      .where(eq(s.imageVariant.imageHash, row.imageHash))
      .returning({ imageHash: s.imageVariant.imageHash })
    return { outcome: 'rewritten' as const, variants: removed.length }
  })
}
