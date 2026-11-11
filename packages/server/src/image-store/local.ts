/**
 * A blob store on the local file system.
 *
 * Layout, under one root:
 *
 *   <root>/sha256/<first two hex characters>/<64 hex characters>   the content, no extension
 *   <root>/tmp/<digest>.<process id>.<random>                      a write in progress
 *
 * A blob appears under its final name only through `rename`, which is atomic inside one file
 * system, so a reader sees a whole blob or none, and a crash leaves at most a stray file in
 * `tmp/`. Both directories sit under the one root so the rename never crosses a file system.
 */
import { randomBytes } from 'node:crypto'
import * as fileSystemModule from 'node:fs/promises'
import * as path from 'node:path'
import { log } from '../logger'
import { assertSha256Hex, hashBytes, SHA256_PATTERN } from './hash'
import type { BlobStat, BlobStore } from './index'

/** The file operations the store uses, so a test can make any one of them fail. */
export type StoreFileSystem = Pick<
  typeof fileSystemModule,
  'mkdir' | 'open' | 'rename' | 'stat' | 'readFile' | 'unlink' | 'readdir'
>

/** How old a file in `tmp/` must be before the start-up sweep deletes it. */
export const STALE_TEMPORARY_FILE_MS = 60 * 60 * 1000

/** Settings for {@link createLocalBlobStore}. Everything but `root` exists so tests can control it. */
export type LocalBlobStoreOptions = {
  /** Directory that holds the store. Created on the first write. */
  root: string
  /** File operations. Defaults to `node:fs/promises`. */
  fileSystem?: StoreFileSystem
  /** Clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number
  /** Random part of a temporary file name. Defaults to eight random bytes in hexadecimal. */
  randomSuffix?: () => string
  /** Process id part of a temporary file name. Defaults to `process.pid`. */
  processId?: number
}

/** A local store, plus the maintenance only a local store has. */
export type LocalBlobStore = BlobStore & {
  /**
   * Deletes temporary files left by a write that never finished.
   *
   * @returns How many files were deleted.
   */
  sweepStaleTemporaryFiles: () => Promise<number>
}

/**
 * Whether an error is the file system saying a path does not exist.
 *
 * @param error Anything that was thrown.
 * @returns True for `ENOENT`.
 */
const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'

/**
 * Creates a store that keeps blobs as files.
 *
 * Nothing touches the disk until the first call that needs it.
 *
 * @param options See {@link LocalBlobStoreOptions}.
 * @returns The store.
 */
export function createLocalBlobStore(options: LocalBlobStoreOptions): LocalBlobStore {
  const {
    root,
    fileSystem = fileSystemModule,
    now = Date.now,
    randomSuffix = () => randomBytes(8).toString('hex'),
    processId = process.pid,
  } = options
  const blobRoot = path.join(root, 'sha256')
  const temporaryRoot = path.join(root, 'tmp')

  /** Final location of a blob. Rejects a malformed digest before any path is built. */
  const blobPath = (sha256: string): string => {
    assertSha256Hex(sha256)
    return path.join(blobRoot, sha256.slice(0, 2), sha256)
  }

  /** Size of a file, or null when it is not there. */
  const sizeOf = async (filePath: string): Promise<number | null> => {
    try {
      return (await fileSystem.stat(filePath)).size
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  /** Flushes a directory's entries to disk, so a completed rename survives a power cut. */
  const syncDirectory = async (directory: string): Promise<void> => {
    const handle = await fileSystem.open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  /** Writes bytes to a new file and flushes them to disk. `wx` refuses to reuse a name. */
  const writeDurably = async (filePath: string, bytes: Uint8Array): Promise<void> => {
    const handle = await fileSystem.open(filePath, 'wx')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const put = async (bytes: Uint8Array): Promise<BlobStat> => {
    const sha256 = hashBytes(bytes)
    const byteSize = bytes.byteLength
    const finalPath = blobPath(sha256)
    // A file of the right size under a name that is its own digest is the same content.
    if ((await sizeOf(finalPath)) === byteSize) return { sha256, byteSize }

    const shardDirectory = path.dirname(finalPath)
    const temporaryPath = path.join(temporaryRoot, `${sha256}.${processId}.${randomSuffix()}`)
    await fileSystem.mkdir(temporaryRoot, { recursive: true })
    await fileSystem.mkdir(shardDirectory, { recursive: true })
    try {
      await writeDurably(temporaryPath, bytes)
      await fileSystem.rename(temporaryPath, finalPath)
    } catch (error) {
      await fileSystem.unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    await syncDirectory(shardDirectory)
    return { sha256, byteSize }
  }

  const get = async (sha256: string): Promise<Buffer | null> => {
    try {
      return await fileSystem.readFile(blobPath(sha256))
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  const stat = async (sha256: string): Promise<BlobStat | null> => {
    const byteSize = await sizeOf(blobPath(sha256))
    return byteSize === null ? null : { sha256, byteSize }
  }

  /** Deletes a file. Returns false, rather than throwing, when it was already gone. */
  const unlinkIfPresent = async (filePath: string): Promise<boolean> => {
    try {
      await fileSystem.unlink(filePath)
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  // `async` so a malformed digest rejects, like every other method, instead of throwing.
  const remove = async (sha256: string): Promise<boolean> => unlinkIfPresent(blobPath(sha256))

  /** Directory entries, or none when the directory does not exist yet. */
  const entriesOf = async (directory: string): Promise<string[]> => {
    try {
      return await fileSystem.readdir(directory)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  async function* list(): AsyncGenerator<BlobStat, void, undefined> {
    for (const shard of await entriesOf(blobRoot)) {
      if (!/^[0-9a-f]{2}$/.test(shard)) continue
      for (const name of await entriesOf(path.join(blobRoot, shard))) {
        // A name that is not a digest filed under its own shard is not ours: leave it out.
        if (!SHA256_PATTERN.test(name) || !name.startsWith(shard)) continue
        const found = await stat(name)
        if (found) yield found
      }
    }
  }

  const sweepStaleTemporaryFiles = async (): Promise<number> => {
    const oldestKept = now() - STALE_TEMPORARY_FILE_MS
    let deleted = 0
    for (const name of await entriesOf(temporaryRoot)) {
      const filePath = path.join(temporaryRoot, name)
      const modifiedAt = await fileSystem.stat(filePath).then(
        (found) => found.mtimeMs,
        () => null,
      )
      if (modifiedAt === null || modifiedAt >= oldestKept) continue
      try {
        if (await unlinkIfPresent(filePath)) deleted += 1
      } catch (error) {
        // One stubborn file must not stop the sweep, or the process that started it.
        log('image store: could not delete stale temporary file: %o', error)
      }
    }
    return deleted
  }

  return { put, get, stat, delete: remove, list, sweepStaleTemporaryFiles }
}
