/**
 * @module image-store/object-blob-store
 * Turns any object storage service into a {@link BlobStore}.
 *
 * The services differ in how they sign requests and what their listings look like, and agree
 * on what a blob store needs: write an object, read it, ask about it, delete it, list a prefix,
 * and refresh its modification time without sending the bytes again. An adapter supplies those
 * six operations as an {@link ObjectClient}; this module supplies everything above them: the
 * key layout, the digest checks, reuse that renews a blob's age, and the walk over a listing.
 *
 * Blobs are immutable objects. Their key is `[prefix]sha256/<first two hex>/<64 hex>`, the same
 * layout as the local store, so a copy of one store's tree is a valid tree for another.
 */
import { log } from '../logger'
import { assertSha256Hex, hashBytes, SHA256_PATTERN } from './hash'
import type { BlobStat, BlobStore } from './types'

/** What an object storage service knows about one object. */
export type ObjectInfo = {
  /** The object's full key. */
  key: string
  /** Length in bytes. */
  byteSize: number
  /** Last write or metadata change, in milliseconds since the epoch. */
  modifiedAtMs: number
}

/** The six operations a service must offer. Keys are complete: the client adds nothing to them. */
export interface ObjectClient {
  /** Writes an object, replacing one with the same key. */
  put(key: string, bytes: Uint8Array): Promise<void>
  /** Reads an object, or returns null when there is none. */
  get(key: string): Promise<Buffer | null>
  /** Describes an object without reading it, or returns null when there is none. */
  head(key: string): Promise<ObjectInfo | null>
  /** Removes an object. Removing one that is not there is not an error. */
  remove(key: string): Promise<void>
  /** Refreshes an object's modification time on the service, without sending its bytes. */
  renew(key: string): Promise<void>
  /** Walks every object whose key starts with the prefix, following the service's paging. */
  list(prefix: string): AsyncIterable<ObjectInfo>
}

/** Settings for {@link createObjectBlobStore}. */
export type ObjectBlobStoreOptions = {
  /** The service. */
  client: ObjectClient
  /** Text put before every key, for a bucket or container that holds more than the store. Defaults to none. */
  keyPrefix?: string
}

/** The directory every blob sits under, inside the key prefix. */
export const BLOB_DIRECTORY = 'sha256/'

/**
 * The object key of a blob.
 *
 * @param sha256 The blob's digest. A malformed one throws a `TypeError`.
 * @param keyPrefix Text before the key. Defaults to none.
 * @returns `[prefix]sha256/<first two hex>/<64 hex>`.
 */
export function objectKeyOf(sha256: string, keyPrefix = ''): string {
  assertSha256Hex(sha256)
  return `${keyPrefix}${BLOB_DIRECTORY}${sha256.slice(0, 2)}/${sha256}`
}

/**
 * The digest a key names, or null when the key is not one the store wrote.
 *
 * @param key An object key from a listing.
 * @param keyPrefix The prefix the store was built with.
 */
export function digestOfObjectKey(key: string, keyPrefix = ''): string | null {
  if (!key.startsWith(keyPrefix + BLOB_DIRECTORY)) return null
  const [shard, name, ...rest] = key.slice(keyPrefix.length + BLOB_DIRECTORY.length).split('/')
  const isOurs = rest.length === 0 && SHA256_PATTERN.test(name ?? '') && name.startsWith(shard)
  return isOurs ? name : null
}

/**
 * Builds a blob store on an object storage service.
 *
 * `put` of bytes that are already stored sends nothing: it asks the service to refresh the
 * object's modification time, so `images gc` sees the reuse. A service that refuses that
 * request gets the bytes again instead, which has the same effect.
 *
 * `delete` asks first, so it can answer false for a blob that was not there; two deletes of
 * one blob at the same moment may both answer true.
 *
 * @param options See {@link ObjectBlobStoreOptions}.
 * @returns The store.
 */
export function createObjectBlobStore(options: ObjectBlobStoreOptions): BlobStore {
  const { client, keyPrefix = '' } = options

  const put = async (bytes: Uint8Array): Promise<BlobStat> => {
    const sha256 = hashBytes(bytes)
    const byteSize = bytes.byteLength
    const key = objectKeyOf(sha256, keyPrefix)
    const present = await client.head(key)
    if (present?.byteSize === byteSize) {
      try {
        await client.renew(key)
        return { sha256, byteSize }
      } catch (error) {
        log('image store: could not renew a stored blob, writing it again: %o', error)
      }
    }
    await client.put(key, bytes)
    return { sha256, byteSize }
  }

  const get = async (sha256: string): Promise<Buffer | null> => client.get(objectKeyOf(sha256, keyPrefix))

  const stat = async (sha256: string): Promise<BlobStat | null> => {
    const found = await client.head(objectKeyOf(sha256, keyPrefix))
    return found === null ? null : { sha256, byteSize: found.byteSize, modifiedAtMs: found.modifiedAtMs }
  }

  const remove = async (sha256: string): Promise<boolean> => {
    const key = objectKeyOf(sha256, keyPrefix)
    if ((await client.head(key)) === null) return false
    await client.remove(key)
    return true
  }

  async function* list(): AsyncGenerator<BlobStat, void, undefined> {
    for await (const found of client.list(keyPrefix + BLOB_DIRECTORY)) {
      const sha256 = digestOfObjectKey(found.key, keyPrefix)
      if (sha256 === null) continue
      yield { sha256, byteSize: found.byteSize, modifiedAtMs: found.modifiedAtMs }
    }
  }

  return { put, get, stat, delete: remove, list }
}
