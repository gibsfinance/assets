/**
 * @module image-store/backfill
 * Moves the bytes of images that predate the image store out of the `image` table, checks the
 * result, and moves them back if the operator needs to roll back.
 *
 * All three operations are safe to run while the server and the collector are running, to
 * stop at any point, and to run again. None of them removes anything from the database: the
 * `content` column is left as it is, so a rollback to the previous release needs no data
 * movement at all. Reclaiming the space is a separate, later step (dropping the column).
 */
import { and, asc, eq, gt, isNull, sql as dsql } from 'drizzle-orm'
import { getDrizzle, type DrizzleDB } from '../db/drizzle'
import * as s from '../db/schema'
import { log } from '../logger'
import { getImageStore, hashBytes, type BlobStore } from './index'

/** How many rows one batch reads. Each row's bytes are held in memory until its batch is done. */
export const DEFAULT_BATCH_SIZE = 50

/** How many example image hashes a report lists for each kind of problem. */
export const EXAMPLE_LIMIT = 20

/** What the operations need. Both default to the process's own; tests pass fakes. */
export type BackfillDependencies = {
  database?: Pick<DrizzleDB, 'select' | 'update' | 'execute'>
  store?: BlobStore
  /** Waits. Defaults to a timer. */
  sleep?: (milliseconds: number) => Promise<void>
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

/** Options for {@link exportImages}. */
export type ExportOptions = BackfillDependencies & {
  /** Rows per batch. Defaults to {@link DEFAULT_BATCH_SIZE}. */
  batchSize?: number
  /** Pause between batches, in milliseconds, to leave the database room for its other work. Defaults to 0. */
  sleepMs?: number
}

/** What {@link exportImages} did. */
export type ExportSummary = {
  /** Rows read. */
  examined: number
  /** Rows whose bytes are now in the store and whose digest and length are recorded. */
  exported: number
  /** Rows that carry no bytes (link-only), now marked with length 0. */
  empty: number
  /**
   * Rows left for a later run because they changed between being read and being marked: another
   * writer replaced the bytes, or already exported the row.
   */
  skipped: number
  /** Total length of the bytes written or confirmed in the store. */
  bytes: number
}

/**
 * Copies every row's bytes into the image store, and records each row's digest and length.
 *
 * Rows are taken in `image_hash` order, a batch at a time, from the first row that has no length
 * recorded yet. Each row is processed in this order: the file is written first, and only then is
 * the row marked, so a row that is marked always has its file. The mark is a guarded update
 * (`byte_size IS NULL` and the bytes still hash to the digest being recorded), so a row that was
 * rewritten, or exported by another process, between the read and the mark is skipped and left
 * for the next run rather than given a digest that names other bytes.
 *
 * Link-only rows have no bytes: they are marked with length 0 and no digest, and no file.
 *
 * @param options See {@link ExportOptions}.
 * @returns Counts of what was done.
 */
export async function exportImages(options: ExportOptions = {}): Promise<ExportSummary> {
  const {
    database = getDrizzle(),
    store = getImageStore(),
    sleep = defaultSleep,
    batchSize = DEFAULT_BATCH_SIZE,
    sleepMs = 0,
  } = options
  const summary: ExportSummary = { examined: 0, exported: 0, empty: 0, skipped: 0, bytes: 0 }
  let cursor = ''
  for (;;) {
    const rows = await database
      .select({ imageHash: s.image.imageHash, content: s.image.content })
      .from(s.image)
      .where(and(isNull(s.image.byteSize), gt(s.image.imageHash, cursor)))
      .orderBy(asc(s.image.imageHash))
      .limit(batchSize)
    if (rows.length === 0) return summary
    for (const row of rows) {
      summary.examined += 1
      const changed = await exportRow(row, { database, store })
      summary[changed.kind] += 1
      summary.bytes += changed.bytes
    }
    cursor = rows[rows.length - 1].imageHash
    log(
      'images export: %d examined, %d exported, %d empty, %d skipped',
      summary.examined,
      summary.exported,
      summary.empty,
      summary.skipped,
    )
    if (sleepMs > 0) await sleep(sleepMs)
  }
}

/** The outcome of one row, as a key of {@link ExportSummary}. */
type RowOutcome = { kind: 'exported' | 'empty' | 'skipped'; bytes: number }

/** Writes one row's file and marks the row, in that order. */
async function exportRow(
  row: { imageHash: string; content: Buffer | null },
  { database, store }: { database: NonNullable<BackfillDependencies['database']>; store: BlobStore },
): Promise<RowOutcome> {
  if (!row.content || row.content.length === 0) {
    const marked = await database
      .update(s.image)
      .set({ byteSize: 0 })
      .where(
        and(
          eq(s.image.imageHash, row.imageHash),
          isNull(s.image.byteSize),
          dsql`(${s.image.content} IS NULL OR octet_length(${s.image.content}) = 0)`,
        ),
      )
      .returning({ imageHash: s.image.imageHash })
    return { kind: marked.length > 0 ? 'empty' : 'skipped', bytes: 0 }
  }
  const stored = await store.put(row.content)
  const marked = await database
    .update(s.image)
    .set({ contentSha256: stored.sha256, byteSize: stored.byteSize })
    .where(
      and(
        eq(s.image.imageHash, row.imageHash),
        isNull(s.image.byteSize),
        dsql`encode(sha256(${s.image.content}), 'hex') = ${stored.sha256}`,
      ),
    )
    .returning({ imageHash: s.image.imageHash })
  return { kind: marked.length > 0 ? 'exported' : 'skipped', bytes: stored.byteSize }
}

/** Options for {@link verifyImages}. */
export type VerifyOptions = BackfillDependencies & {
  /** Digests read from the database per page when walking the files. Defaults to 1000. */
  pageSize?: number
  /** Also read every file and hash it, instead of trusting its name and length. Slower. */
  rehash?: boolean
}

/** What {@link verifyImages} found. Every list is capped at {@link EXAMPLE_LIMIT} image hashes or digests. */
export type VerifySummary = {
  /** Rows with no length recorded: not exported yet. */
  pendingRows: number
  /** Rows with a digest and no length, or a length and no digest where one is required. */
  inconsistentRows: number
  /** Rows whose bytes still in the database do not hash to the row's digest, or are not its length. */
  databaseMismatchRows: number
  /** Distinct digests whose files were looked at. */
  filesChecked: number
  /** Digests no file exists for. */
  missingFiles: string[]
  /** Digests whose file is not the recorded length. */
  wrongSizeFiles: string[]
  /** Digests whose file does not hash to its name. Only checked with `rehash`. */
  wrongDigestFiles: string[]
  /** Example `image_hash` values for each row-level problem. */
  examples: { inconsistent: string[]; databaseMismatch: string[] }
  /** True when nothing above is wrong: it is safe to stop writing bytes to the database. */
  ok: boolean
}

/**
 * Checks that every image's bytes are where its row says.
 *
 * Four things are checked, and a run is `ok` only when all four are clean:
 *  1. No row is left unexported (`byte_size IS NULL`).
 *  2. No row is half described (a digest without a length).
 *  3. Where a row still carries bytes, they hash to its digest and have its length. This hashes
 *     every such row inside Postgres, so it is the slow part.
 *  4. Every digest a row names has a file of the recorded length (and, with `rehash`, a file that
 *     hashes to its name).
 *
 * Nothing is changed.
 *
 * @param options See {@link VerifyOptions}.
 */
export async function verifyImages(options: VerifyOptions = {}): Promise<VerifySummary> {
  const { database = getDrizzle(), store = getImageStore(), pageSize = 1000, rehash = false } = options

  const [pending] = (
    await database.execute<{ total: number }>(
      dsql`SELECT count(*)::int AS total FROM ${s.image} WHERE ${s.image.byteSize} IS NULL`,
    )
  ).rows
  const inconsistent = await countWithExamples(
    database,
    dsql`(${s.image.contentSha256} IS NOT NULL AND ${s.image.byteSize} IS NULL)
      OR (${s.image.contentSha256} IS NULL AND ${s.image.byteSize} > 0)`,
  )
  const mismatch = await countWithExamples(
    database,
    dsql`${s.image.content} IS NOT NULL AND ${s.image.contentSha256} IS NOT NULL
      AND (encode(sha256(${s.image.content}), 'hex') IS DISTINCT FROM ${s.image.contentSha256}
        OR octet_length(${s.image.content}) IS DISTINCT FROM ${s.image.byteSize})`,
  )

  const files = await checkFiles({ database, store, pageSize, rehash })

  const summary: VerifySummary = {
    pendingRows: pending.total,
    inconsistentRows: inconsistent.total,
    databaseMismatchRows: mismatch.total,
    filesChecked: files.checked,
    missingFiles: files.missing,
    wrongSizeFiles: files.wrongSize,
    wrongDigestFiles: files.wrongDigest,
    examples: { inconsistent: inconsistent.examples, databaseMismatch: mismatch.examples },
    ok: false,
  }
  summary.ok =
    summary.pendingRows === 0 &&
    summary.inconsistentRows === 0 &&
    summary.databaseMismatchRows === 0 &&
    files.missingTotal === 0 &&
    files.wrongSizeTotal === 0 &&
    files.wrongDigestTotal === 0
  return summary
}

/** How many rows match a condition, and the hashes of the first few. */
async function countWithExamples(
  database: NonNullable<BackfillDependencies['database']>,
  condition: ReturnType<typeof dsql>,
): Promise<{ total: number; examples: string[] }> {
  const { rows } = await database.execute<{ total: number; examples: string[] | null }>(dsql`
    SELECT count(*)::int AS total,
      (array_agg(${s.image.imageHash} ORDER BY ${s.image.imageHash}))[1:${EXAMPLE_LIMIT}] AS examples
    FROM ${s.image}
    WHERE ${condition}
  `)
  return { total: rows[0].total, examples: rows[0].examples ?? [] }
}

/** Looks at the file of every distinct digest the table names, a page at a time. */
async function checkFiles({
  database,
  store,
  pageSize,
  rehash,
}: {
  database: NonNullable<BackfillDependencies['database']>
  store: BlobStore
  pageSize: number
  rehash: boolean
}) {
  const found = {
    checked: 0,
    missing: [] as string[],
    missingTotal: 0,
    wrongSize: [] as string[],
    wrongSizeTotal: 0,
    wrongDigest: [] as string[],
    wrongDigestTotal: 0,
  }
  const note = (kind: 'missing' | 'wrongSize' | 'wrongDigest', sha256: string) => {
    found[`${kind}Total`] += 1
    if (found[kind].length < EXAMPLE_LIMIT) found[kind].push(sha256)
  }
  let cursor = ''
  for (;;) {
    const { rows } = await database.execute<{ sha256: string; byteSize: number }>(dsql`
      SELECT DISTINCT ON (${s.image.contentSha256}) ${s.image.contentSha256} AS "sha256", ${s.image.byteSize} AS "byteSize"
      FROM ${s.image}
      WHERE ${s.image.contentSha256} IS NOT NULL AND ${s.image.contentSha256} > ${cursor}
      ORDER BY ${s.image.contentSha256}
      LIMIT ${pageSize}
    `)
    if (rows.length === 0) return found
    for (const row of rows) {
      found.checked += 1
      const stat = await store.stat(row.sha256)
      if (stat === null) {
        note('missing', row.sha256)
        continue
      }
      if (stat.byteSize !== row.byteSize) {
        note('wrongSize', row.sha256)
        continue
      }
      if (!rehash) continue
      const bytes = await store.get(row.sha256)
      if (bytes === null || hashBytes(bytes) !== row.sha256) note('wrongDigest', row.sha256)
    }
    cursor = rows[rows.length - 1].sha256
  }
}

/** Options for {@link importImages}. */
export type ImportOptions = BackfillDependencies & {
  /** Rows per batch. Defaults to {@link DEFAULT_BATCH_SIZE}. */
  batchSize?: number
  /** Pause between batches, in milliseconds. Defaults to 0. */
  sleepMs?: number
}

/** What {@link importImages} did. */
export type ImportSummary = {
  /** Rows that had no bytes in the database and a file in the store. */
  examined: number
  /** Rows whose bytes are back in `content`. */
  restored: number
  /** Rows whose file is missing from the store, left as they were. */
  missingFiles: number
  /** Rows that changed between being read and being written, left as they were. */
  skipped: number
}

/**
 * Puts bytes back into `content` for every row that has them only in the store. This is the
 * rollback for the setting `IMAGE_BYTES_IN_DATABASE=false`: run it, and then the previous
 * release, which reads `content`, finds every image again.
 *
 * Rows are written only when `content` is still NULL and the digest is still the one that was
 * read, so a concurrent write is never overwritten. The digest and length stay on the row; the
 * guard in the database that clears a stale digest does not fire, because these bytes hash to it.
 *
 * @param options See {@link ImportOptions}.
 */
export async function importImages(options: ImportOptions = {}): Promise<ImportSummary> {
  const {
    database = getDrizzle(),
    store = getImageStore(),
    sleep = defaultSleep,
    batchSize = DEFAULT_BATCH_SIZE,
    sleepMs = 0,
  } = options
  const summary: ImportSummary = { examined: 0, restored: 0, missingFiles: 0, skipped: 0 }
  let cursor = ''
  for (;;) {
    const rows = await database
      .select({ imageHash: s.image.imageHash, contentSha256: s.image.contentSha256 })
      .from(s.image)
      .where(and(isNull(s.image.content), gt(s.image.byteSize, 0), gt(s.image.imageHash, cursor)))
      .orderBy(asc(s.image.imageHash))
      .limit(batchSize)
    if (rows.length === 0) return summary
    for (const row of rows) {
      summary.examined += 1
      // The query selects rows with a length above 0, which always have a digest.
      const sha256 = row.contentSha256 as string
      const bytes = await store.get(sha256)
      if (bytes === null) {
        summary.missingFiles += 1
        continue
      }
      const restored = await database
        .update(s.image)
        .set({ content: bytes })
        .where(and(eq(s.image.imageHash, row.imageHash), isNull(s.image.content), eq(s.image.contentSha256, sha256)))
        .returning({ imageHash: s.image.imageHash })
      if (restored.length > 0) summary.restored += 1
      else summary.skipped += 1
    }
    cursor = rows[rows.length - 1].imageHash
    log('images import: %d examined, %d restored, %d missing', summary.examined, summary.restored, summary.missingFiles)
    if (sleepMs > 0) await sleep(sleepMs)
  }
}
