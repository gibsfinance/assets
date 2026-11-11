import { hashBytes } from '../hash'
import type { BlobStat, BlobStore } from '../index'

/** A blob store in memory, for tests of code that uses a {@link BlobStore}. */
export type MemoryBlobStore = BlobStore & {
  /** What is stored, by digest, with the time each blob was last written or reused. */
  blobs: Map<string, { bytes: Buffer; modifiedAtMs: number }>
  /** Digests passed to `put`, in call order, including repeats. */
  puts: string[]
  /** Sets what the store believes the time is, for the next `put`. */
  setNow: (milliseconds: number) => void
}

/**
 * Builds an empty in-memory store whose clock the test controls.
 *
 * @param startMs The store's clock at the start. Defaults to 0.
 */
export const createMemoryBlobStore = (startMs = 0): MemoryBlobStore => {
  let now = startMs
  const blobs = new Map<string, { bytes: Buffer; modifiedAtMs: number }>()
  const puts: string[] = []
  return {
    blobs,
    puts,
    setNow: (milliseconds) => {
      now = milliseconds
    },
    put: async (bytes) => {
      const sha256 = hashBytes(bytes)
      puts.push(sha256)
      blobs.set(sha256, { bytes: Buffer.from(bytes), modifiedAtMs: now })
      return { sha256, byteSize: bytes.byteLength }
    },
    get: async (sha256) => blobs.get(sha256)?.bytes ?? null,
    stat: async (sha256) => {
      const blob = blobs.get(sha256)
      return blob ? { sha256, byteSize: blob.bytes.length, modifiedAtMs: blob.modifiedAtMs } : null
    },
    delete: async (sha256) => blobs.delete(sha256),
    list: async function* (): AsyncGenerator<BlobStat> {
      for (const [sha256, blob] of [...blobs]) {
        yield { sha256, byteSize: blob.bytes.length, modifiedAtMs: blob.modifiedAtMs }
      }
    },
  }
}
