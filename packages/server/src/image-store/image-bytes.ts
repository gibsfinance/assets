import { failureLog } from '@gibs/utils'
import { getImageStore, type BlobStore } from './index'

/** The columns of an `image` row that say where its bytes are. */
export type ImageByteLocation = {
  /** The row's key, for the log line when a file is missing. */
  imageHash: string
  /** The bytes the row carries itself. Null, or narrowed away, once a digest names a file. */
  content: Buffer | null
  /** Digest of the bytes, and so the name of the file in the store. Null before export. */
  contentSha256: string | null
}

/**
 * The bytes of one image, wherever they are kept.
 *
 * Bytes the row carries come back as they are (an exported row's query already narrowed them
 * away, see `image-columns.ts`); a row with a digest is read from the store. This is correct
 * before the backfill (no digest, bytes in the row), part way through it, after it, and once
 * new rows are written without bytes.
 *
 * A file that is missing is logged and answered with null, so the caller takes its ordinary
 * "no bytes" path (a redirect to the source address, or a 404) instead of failing the request.
 * Any other failure to read the store is thrown.
 *
 * @param location Where the row says its bytes are.
 * @param store The store to read. Defaults to the process's own.
 * @returns The bytes, or null when the row has none to give.
 */
export async function loadImageBytes(location: ImageByteLocation, store?: BlobStore): Promise<Buffer | null> {
  // An empty buffer is still bytes the row carries (a link-only row), so this tests for the
  // object, not for its length.
  if (location.content) return location.content
  if (!location.contentSha256) return null
  const bytes = await (store ?? getImageStore()).get(location.contentSha256)
  if (bytes === null) {
    failureLog('image store: no file for image %o (sha256 %o)', location.imageHash, location.contentSha256)
  }
  return bytes
}

/**
 * Returns a copy of an image row with its bytes filled in by {@link loadImageBytes}.
 *
 * @param row An `image` row, possibly joined with other tables.
 * @param store The store to read. Defaults to the process's own.
 */
export async function withImageBytes<Row extends ImageByteLocation>(
  row: Row,
  store?: BlobStore,
): Promise<Row & { content: Buffer | null }> {
  return { ...row, content: await loadImageBytes(row, store) }
}
