/**
 * Content-addressed storage for image bytes.
 *
 * A blob is named by the sha256 of its bytes, so the same bytes are stored once however many
 * rows point at them, and a name can never refer to different content. The `image` table
 * keeps each blob's digest (`content_sha256`) and length (`byte_size`); the bytes themselves
 * are read through `loadImageBytes` and written by `insertImage` before its row commits.
 */
import config from '../../config'
import { ImageStoreConfigurationError } from './configuration-error'
import { createBlobStoreFromSpec } from './store-config'
import type { BlobStore } from './types'

export { assertSha256Hex, hashBytes, isSha256Hex } from './hash'
export { ImageStoreConfigurationError } from './configuration-error'

export type { BlobStat, BlobStore } from './types'

let sharedStore: BlobStore | undefined

/**
 * The process's blob store, built from configuration on first use.
 *
 * Which store it is comes from `IMAGE_STORE` (see `store-config.ts`): a directory by default
 * (`IMAGE_STORE_DIR`), or object storage, IPFS, or a combination. A local store also starts a
 * background sweep of temporary files that an earlier crash left behind; a failed sweep is
 * logged and never reaches the caller.
 *
 * @returns The shared store.
 * @throws ImageStoreConfigurationError when the configuration is missing or wrong.
 */
export function getImageStore(): BlobStore {
  if (sharedStore) return sharedStore
  sharedStore = createBlobStoreFromSpec(config.imageStore || 'local', {
    defaultLocalDirectory: config.imageStoreDirectory,
  })
  return sharedStore
}

/** Where {@link initializeImageStore} writes its message and how it ends the process. Tests replace both. */
export type InitializeImageStoreOptions = {
  /** Prints the message. Defaults to standard error. */
  report?: (message: string) => void
  /** Ends the process. Defaults to `process.exit`. */
  exit?: (code: number) => void
}

/**
 * Builds the shared store at start-up, so a missing or invalid setting stops the process with
 * one clear line instead of failing on the first image request.
 *
 * @param options See {@link InitializeImageStoreOptions}.
 * @returns The store, or undefined after `exit` was called for a configuration error.
 * @throws Anything that is not a configuration error.
 */
export function initializeImageStore(options: InitializeImageStoreOptions = {}): BlobStore | undefined {
  const { report = (message) => console.error(message), exit = (code) => process.exit(code) } = options
  try {
    return getImageStore()
  } catch (error) {
    if (!(error instanceof ImageStoreConfigurationError)) throw error
    report(`image store configuration error: ${error.message}`)
    exit(1)
    return undefined
  }
}

/**
 * Forgets the shared store, so the next {@link getImageStore} builds a new one.
 * For tests that point the store at a different directory.
 */
export function resetImageStoreForTests(): void {
  sharedStore = undefined
}
