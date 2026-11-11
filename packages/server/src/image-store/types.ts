/**
 * @module image-store/types
 * The contract every blob store adapter implements. Kept apart from `index.ts` so adapters can
 * import it without pulling in configuration.
 */

/** What the store knows about one blob. */
export type BlobStat = {
  /** The blob's name: the sha256 of its bytes, 64 lowercase hexadecimal characters. */
  sha256: string
  /** Length of the blob in bytes. */
  byteSize: number
  /**
   * When the blob was last written or reused, in milliseconds since the epoch. Present on what
   * `stat` and `list` return, absent on what `put` returns. A clean-up that goes by age
   * (`images gc`) reads it.
   */
  modifiedAtMs?: number
}

/**
 * Storage for blobs named by the sha256 of their bytes.
 *
 * Every method that takes a digest throws a `TypeError` for anything that is not 64 lowercase
 * hexadecimal characters, before it touches storage.
 */
export interface BlobStore {
  /**
   * Stores bytes under their own digest. Storing bytes that are already present writes nothing,
   * but renews the blob's modification time, so age-based clean-up sees the reuse.
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
