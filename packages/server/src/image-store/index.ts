/**
 * Content-addressed storage for image bytes.
 *
 * A blob is named by the sha256 of its bytes, so the same bytes are stored once however many
 * rows point at them, and a name can never refer to different content. Nothing calls this
 * module yet; it is the destination for moving image bytes out of the database.
 */
import config from '../../config'
import { log } from '../logger'
import { createLocalBlobStore } from './local'

export { assertSha256Hex, hashBytes, isSha256Hex } from './hash'

/** What the store knows about one blob. */
export type BlobStat = {
  /** The blob's name: the sha256 of its bytes, 64 lowercase hexadecimal characters. */
  sha256: string
  /** Length of the blob in bytes. */
  byteSize: number
}

/**
 * Storage for blobs named by the sha256 of their bytes.
 *
 * Every method that takes a digest throws a `TypeError` for anything that is not 64 lowercase
 * hexadecimal characters, before it touches storage.
 */
export interface BlobStore {
  /**
   * Stores bytes under their own digest. Storing bytes that are already present writes nothing.
   *
   * @param bytes The content.
   * @returns The digest and length of what is now stored.
   */
  put(bytes: Uint8Array): Promise<BlobStat>

  /**
   * Reads a blob.
   *
   * The bytes are returned as stored; they are not hashed again on the way out.
   *
   * @param sha256 The blob's digest.
   * @returns The bytes, or null when no such blob exists.
   */
  get(sha256: string): Promise<Buffer | null>

  /**
   * Looks a blob up without reading it.
   *
   * @param sha256 The blob's digest.
   * @returns The blob's digest and length, or null when no such blob exists.
   */
  stat(sha256: string): Promise<BlobStat | null>

  /**
   * Removes a blob.
   *
   * @param sha256 The blob's digest.
   * @returns True when a blob was removed, false when there was none.
   */
  delete(sha256: string): Promise<boolean>

  /**
   * Walks every stored blob, in no particular order. Blobs added or removed during the walk
   * may or may not appear.
   *
   * @returns An asynchronous iterator of digests and lengths.
   */
  list(): AsyncIterable<BlobStat>
}

let sharedStore: BlobStore | undefined

/**
 * The process's blob store, built from configuration on first use.
 *
 * Today that is a directory (`IMAGE_STORE_DIR`, see `config.ts`). Building it also starts a
 * background sweep of temporary files that an earlier crash left behind; a failed sweep is
 * logged and never reaches the caller.
 *
 * @returns The shared store.
 */
export function getImageStore(): BlobStore {
  if (sharedStore) return sharedStore
  const store = createLocalBlobStore({ root: config.imageStoreDirectory })
  store.sweepStaleTemporaryFiles().then(
    (deleted) => deleted > 0 && log('image store: swept %d stale temporary files', deleted),
    (error: unknown) => log('image store: temporary file sweep failed: %o', error),
  )
  sharedStore = store
  return store
}

/**
 * Forgets the shared store, so the next {@link getImageStore} builds a new one.
 * For tests that point the store at a different directory.
 */
export function resetImageStoreForTests(): void {
  sharedStore = undefined
}
