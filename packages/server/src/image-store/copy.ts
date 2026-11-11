/**
 * @module image-store/copy
 * Moves every blob of one store into another: the way to change providers, to seed a mirror's
 * new member, or to fill a cache.
 *
 * It reads only through the {@link BlobStore} interface, so any two stores work, composites
 * included. It is safe to stop and run again: a blob the destination already holds, with the
 * same length, is skipped. Every blob is hashed after it is read and must equal the digest it is
 * named by; bytes that do not match are reported and never written.
 */
import { log } from '../logger'
import { hashBytes } from './hash'
import type { BlobStore } from './types'

/** Settings for {@link copyBlobs}. */
export type CopyOptions = {
  from: BlobStore
  to: BlobStore
  /** How many blobs are copied at once. Defaults to 4. */
  concurrency?: number
  /** Called after every this-many blobs are scanned, with the running summary. Defaults to never. */
  onProgress?: (summary: CopySummary) => void
  /** Scans between progress reports. Defaults to 1000. */
  progressEvery?: number
}

/** What {@link copyBlobs} did. */
export type CopySummary = {
  /** Blobs listed in the source. */
  scanned: number
  /** Blobs written to the destination. */
  copied: number
  /** Blobs the destination already held with the same length. */
  skippedExisting: number
  /** Blobs whose bytes did not hash to their name. Not written. */
  corrupt: number
  /** Blobs the source listed but could not read. */
  missing: number
  /** Blobs that failed for another reason, such as a refused write. */
  failed: number
  /** Total length of the blobs written. */
  bytesCopied: number
  /** The first few failures, each naming a digest. */
  errors: string[]
  /** True when nothing was corrupt, missing or failed. */
  ok: boolean
}

/** The most failures kept in {@link CopySummary.errors}. */
export const MAXIMUM_REPORTED_ERRORS = 10

/** Default for {@link CopyOptions.concurrency}. */
export const DEFAULT_COPY_CONCURRENCY = 4

/**
 * Copies every blob from one store to another.
 *
 * @param options See {@link CopyOptions}.
 * @returns What was done.
 */
export async function copyBlobs(options: CopyOptions): Promise<CopySummary> {
  const { from, to, concurrency = DEFAULT_COPY_CONCURRENCY, onProgress, progressEvery = 1000 } = options
  const summary: CopySummary = {
    scanned: 0,
    copied: 0,
    skippedExisting: 0,
    corrupt: 0,
    missing: 0,
    failed: 0,
    bytesCopied: 0,
    errors: [],
    ok: true,
  }
  const note = (message: string): void => {
    if (summary.errors.length < MAXIMUM_REPORTED_ERRORS) summary.errors.push(message)
  }

  const copyOne = async (sha256: string, byteSize: number): Promise<void> => {
    const present = await to.stat(sha256)
    if (present?.byteSize === byteSize) {
      summary.skippedExisting += 1
      return
    }
    const bytes = await from.get(sha256)
    if (bytes === null) {
      summary.missing += 1
      note(`${sha256}: listed but cannot be read`)
      return
    }
    if (hashBytes(bytes) !== sha256) {
      summary.corrupt += 1
      note(`${sha256}: the bytes do not match the digest`)
      return
    }
    const stored = await to.put(bytes)
    if (stored.sha256 !== sha256) {
      summary.failed += 1
      note(`${sha256}: the destination stored it under ${stored.sha256}`)
      return
    }
    summary.copied += 1
    summary.bytesCopied += bytes.byteLength
  }

  const inFlight = new Set<Promise<void>>()
  for await (const { sha256, byteSize } of from.list()) {
    summary.scanned += 1
    const task: Promise<void> = copyOne(sha256, byteSize)
      .catch((error: unknown) => {
        summary.failed += 1
        note(`${sha256}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => inFlight.delete(task))
    inFlight.add(task)
    if (inFlight.size >= concurrency) await Promise.race(inFlight)
    if (onProgress && summary.scanned % progressEvery === 0) onProgress({ ...summary })
  }
  await Promise.all(inFlight)
  summary.ok = summary.corrupt + summary.missing + summary.failed === 0
  log(
    'images copy: %d scanned, %d copied, %d skipped, %d problems',
    summary.scanned,
    summary.copied,
    summary.skippedExisting,
    summary.corrupt + summary.missing + summary.failed,
  )
  return summary
}
