/**
 * @module image-store/composite
 * Stores built only from other stores.
 *
 * - {@link createTieredBlobStore}: a bounded cache in front of a slower store.
 * - {@link createMirroredBlobStore}: several stores that all hold every blob.
 * - {@link createFallbackBlobStore}: one store that is written, and one that is only read.
 *
 * None of them knows what kind of store it wraps, so they nest: a tiered store over a mirror of
 * two buckets, or a fallback whose primary is tiered.
 */
import { log } from '../logger'
import { ImageStoreConfigurationError } from './configuration-error'
import { assertSha256Hex } from './hash'
import { BlobStoreError } from './http'
import type { BlobStat, BlobStore } from './types'

/**
 * Asks stores in order until one gives an answer that is not null.
 *
 * A store that throws does not end the search: the next store is asked. If no store answers and
 * any threw, the first error is thrown, because "nobody has it" cannot be told from "somebody
 * who might have it could not say". If no store threw, the answer is null.
 *
 * @param stores The stores, most preferred first.
 * @param ask The question to put to each.
 * @returns The first answer that is not null, or null.
 * @throws The first error, when no store answered and at least one failed.
 */
export async function askInOrder<Answer>(
  stores: readonly BlobStore[],
  ask: (store: BlobStore) => Promise<Answer | null>,
): Promise<Answer | null> {
  let firstError: { error: unknown } | undefined
  for (const store of stores) {
    try {
      const answer = await ask(store)
      if (answer !== null) return answer
    } catch (error) {
      firstError ??= { error }
      log('image store: a store failed, asking the next one: %o', error)
    }
  }
  if (firstError) throw firstError.error
  return null
}

/**
 * `get` and `stat` over stores asked in order (see {@link askInOrder}). A malformed digest is
 * refused before any store is asked.
 */
const readInOrder = (stores: readonly BlobStore[]): Pick<BlobStore, 'get' | 'stat'> => ({
  get: async (sha256) => {
    assertSha256Hex(sha256)
    return askInOrder(stores, (store) => store.get(sha256))
  },
  stat: async (sha256) => {
    assertSha256Hex(sha256)
    return askInOrder(stores, (store) => store.stat(sha256))
  },
})

/** Settings for {@link createTieredBlobStore}. */
export type TieredBlobStoreOptions = {
  /** The fast store that holds recent blobs. Usually a local directory. */
  cache: BlobStore
  /** The store that holds every blob and is the source of truth. */
  backing: BlobStore
  /** The most bytes the cache may hold. A blob larger than this is never cached. */
  maxCacheBytes: number
}

/**
 * A bounded cache in front of another store.
 *
 * Reads go to the cache first and fill it from the backing store on a miss. Writes go to the
 * backing store first, which is where they must be durable, and then into the cache. When the
 * cache holds more than its limit, the least recently used blobs are deleted from it until it
 * fits. `stat`, `list` and `delete` go to the backing store, because only it knows what exists
 * and how old it is; a delete also removes the cached copy.
 *
 * Recency is kept in memory, in the order blobs were last read or written, and is rebuilt from
 * the cache's own `list` (oldest modification first) when the process starts, so a restart keeps
 * the cache but forgets who was read last. The memory cost is one entry per cached blob.
 *
 * A failure to fill or trim the cache is logged and never fails the request: the cache is an
 * optimisation, and the backing store has the bytes.
 *
 * @param options See {@link TieredBlobStoreOptions}.
 * @returns The store.
 * @throws ImageStoreConfigurationError when the limit is not a positive whole number.
 */
export function createTieredBlobStore(options: TieredBlobStoreOptions): BlobStore {
  const { cache, backing, maxCacheBytes } = options
  if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 1) {
    throw new ImageStoreConfigurationError('the cache size must be a whole number of bytes, at least 1')
  }

  /** Cached blobs and their lengths, least recently used first. A Map keeps insertion order. */
  const recency = new Map<string, number>()
  let cachedBytes = 0
  let loading: Promise<void> | undefined

  const forget = (sha256: string): void => {
    cachedBytes -= recency.get(sha256) ?? 0
    recency.delete(sha256)
  }

  const remember = (sha256: string, byteSize: number): void => {
    forget(sha256)
    recency.set(sha256, byteSize)
    cachedBytes += byteSize
  }

  /** Reads what the cache already holds, once, so trimming counts blobs from before this process. */
  const loadRecency = (): Promise<void> => {
    loading ??= (async () => {
      const held: BlobStat[] = []
      for await (const stat of cache.list()) held.push(stat)
      held.sort((a, b) => (a.modifiedAtMs ?? 0) - (b.modifiedAtMs ?? 0))
      for (const stat of held) remember(stat.sha256, stat.byteSize)
    })()
    return loading
  }

  const trim = async (): Promise<void> => {
    while (cachedBytes > maxCacheBytes) {
      const [oldest] = recency.keys()
      forget(oldest)
      await cache.delete(oldest)
    }
  }

  /** Puts bytes in the cache and trims it. Never throws. */
  const fill = async (bytes: Uint8Array): Promise<void> => {
    if (bytes.byteLength > maxCacheBytes) return
    try {
      await loadRecency()
      const stored = await cache.put(bytes)
      remember(stored.sha256, stored.byteSize)
      await trim()
    } catch (error) {
      log('image store: could not fill or trim the cache: %o', error)
    }
  }

  const get = async (sha256: string): Promise<Buffer | null> => {
    const cached = await cache.get(assertSha256Hex(sha256))
    if (cached) {
      if (recency.has(sha256)) remember(sha256, cached.byteLength)
      return cached
    }
    const bytes = await backing.get(sha256)
    if (bytes) await fill(bytes)
    return bytes
  }

  const put = async (bytes: Uint8Array): Promise<BlobStat> => {
    const stored = await backing.put(bytes)
    await fill(bytes)
    return stored
  }

  const remove = async (sha256: string): Promise<boolean> => {
    const removed = await backing.delete(assertSha256Hex(sha256))
    forget(sha256)
    await cache.delete(sha256).catch((error: unknown) => log('image store: could not drop a cached blob: %o', error))
    return removed
  }

  return {
    put,
    get,
    stat: (sha256) => backing.stat(sha256),
    delete: remove,
    list: () => backing.list(),
  }
}

/** Settings for {@link createMirroredBlobStore}. */
export type MirroredBlobStoreOptions = {
  /** The stores, most preferred for reading first. */
  stores: readonly BlobStore[]
  /**
   * How many stores must accept a write for it to count. Defaults to all of them, which makes
   * the mirror as durable as its weakest member; lower it to keep writing while one is down.
   */
  minimumWrites?: number
}

const rejected = (results: PromiseSettledResult<unknown>[]): unknown[] =>
  results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)

/**
 * Several stores that each hold every blob.
 *
 * Writes go to all of them at once. Reads and `stat` take the first store that answers, so a
 * store added during a migration serves what it has and the old one serves the rest. `delete`
 * goes to all of them. `list` is the union: a blob held by any store appears once, with the
 * newest modification time any store gives it, so `images gc` never removes something a member
 * has just reused. Building that union holds one entry per distinct blob in memory.
 *
 * A mirror does not copy blobs a member lacks. Use `images copy` to bring a new member up to date.
 *
 * @param options See {@link MirroredBlobStoreOptions}.
 * @returns The store.
 * @throws ImageStoreConfigurationError when there are no stores or `minimumWrites` is out of range.
 */
export function createMirroredBlobStore(options: MirroredBlobStoreOptions): BlobStore {
  const { stores } = options
  const minimumWrites = options.minimumWrites ?? stores.length
  if (stores.length === 0) throw new ImageStoreConfigurationError('a mirrored store needs at least one store')
  if (!Number.isInteger(minimumWrites) || minimumWrites < 1 || minimumWrites > stores.length) {
    throw new ImageStoreConfigurationError(`minimumWrites must be a whole number from 1 to ${stores.length}`)
  }

  const put = async (bytes: Uint8Array): Promise<BlobStat> => {
    const results = await Promise.allSettled(stores.map((store) => store.put(bytes)))
    const failures = rejected(results)
    const accepted = results.length - failures.length
    if (accepted < minimumWrites) {
      throw new BlobStoreError(
        `mirrored put: ${accepted} of ${stores.length} stores accepted the blob, ${minimumWrites} needed`,
        undefined,
        {
          cause: failures[0],
        },
      )
    }
    if (failures.length > 0)
      log('image store: %d of %d mirrored stores failed a write: %o', failures.length, stores.length, failures)
    return (results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<BlobStat>).value
  }

  const remove = async (sha256: string): Promise<boolean> => {
    assertSha256Hex(sha256)
    const results = await Promise.allSettled(stores.map((store) => store.delete(sha256)))
    const [firstFailure] = rejected(results)
    if (firstFailure) throw firstFailure
    return results.some((result) => result.status === 'fulfilled' && result.value)
  }

  async function* list(): AsyncGenerator<BlobStat, void, undefined> {
    const union = new Map<string, BlobStat>()
    for (const store of stores) {
      for await (const stat of store.list()) {
        const seen = union.get(stat.sha256)
        union.set(stat.sha256, seen && (seen.modifiedAtMs ?? 0) >= (stat.modifiedAtMs ?? 0) ? seen : stat)
      }
    }
    yield* union.values()
  }

  return {
    put,
    ...readInOrder(stores),
    delete: remove,
    list,
  }
}

/** Settings for {@link createFallbackBlobStore}. */
export type FallbackBlobStoreOptions = {
  /** Where blobs are written, listed and deleted, and the first place they are read. */
  primary: BlobStore
  /** Read when the primary has nothing. Never written to, listed or deleted from. */
  fallback: BlobStore
}

/**
 * A store that reads from another store it does not own.
 *
 * For an installation that shares another's blobs, such as staging reading production's. Reads
 * and `stat` try the primary and then the fallback. Writes, deletes and `list` touch only the
 * primary, so `images gc` run here can never remove a blob from the shared store, and the shared
 * store never receives this installation's blobs.
 *
 * Give the fallback credentials that cannot write; nothing here would use them, and a store that
 * cannot write is the guarantee that holds if this code is ever wrong.
 *
 * @param options See {@link FallbackBlobStoreOptions}.
 * @returns The store.
 */
export function createFallbackBlobStore(options: FallbackBlobStoreOptions): BlobStore {
  const { primary, fallback } = options
  return {
    put: (bytes) => primary.put(bytes),
    ...readInOrder([primary, fallback]),
    delete: (sha256) => primary.delete(sha256),
    list: () => primary.list(),
  }
}
