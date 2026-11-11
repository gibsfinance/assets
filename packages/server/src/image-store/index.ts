/**
 * Content-addressed storage for image bytes.
 *
 * A blob is named by the sha256 of its bytes, so the same bytes are stored once however many
 * rows point at them, and a name can never refer to different content. The `image` table
 * keeps each blob's digest (`content_sha256`) and length (`byte_size`); the bytes themselves
 * are read through `loadImageBytes` and written by `insertImage` before its row commits.
 */
import config from '../../config'
import { log } from '../logger'
import { createLocalBlobStore } from './local'
import type { BlobStore } from './types'

export { assertSha256Hex, hashBytes, isSha256Hex } from './hash'

export type { BlobStat, BlobStore } from './types'

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
