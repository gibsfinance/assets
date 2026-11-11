import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { createFakeClock, type FakeClock } from './__testing__/fake-clock'
import { createFakeAzure } from './__testing__/fake-azure'
import { createFakeS3 } from './__testing__/fake-s3'
import { createMemoryObjectClient } from './__testing__/memory-object-client'
import { createAzureBlobStore } from './azure'
import { askInOrder, createFallbackBlobStore, createMirroredBlobStore, createTieredBlobStore } from './composite'
import { ImageStoreConfigurationError } from './configuration-error'
import { hashBytes } from './hash'
import { BlobStoreError } from './http'
import { createLocalBlobStore } from './local'
import { createObjectBlobStore } from './object-blob-store'
import { createS3BlobStore } from './s3'
import type { BlobStat, BlobStore } from './types'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('../logger', () => ({ log: logMock }))

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fileSystem.rm(directory, { recursive: true, force: true })),
  )
})

const objectStore = (clock: FakeClock): BlobStore =>
  createObjectBlobStore({ client: createMemoryObjectClient(clock, 2) })

const localStore = async (): Promise<BlobStore> => {
  const root = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-store-composite-'))
  temporaryDirectories.push(root)
  return createLocalBlobStore({ root })
}

/** A store whose chosen methods fail, and that counts every call. */
type Spied = BlobStore & {
  calls: Record<keyof BlobStore, number>
  failWith: (method: keyof BlobStore, error: Error) => void
}
const spy = (inner: BlobStore): Spied => {
  const failures = new Map<keyof BlobStore, Error>()
  const calls = { put: 0, get: 0, stat: 0, delete: 0, list: 0 }
  const wrap =
    <Method extends 'put' | 'get' | 'stat' | 'delete'>(method: Method) =>
    async (...args: Parameters<BlobStore[Method]>) => {
      calls[method] += 1
      const failure = failures.get(method)
      if (failure) throw failure
      return (inner[method] as (...parameters: unknown[]) => Promise<unknown>)(...args)
    }
  return {
    calls,
    failWith: (method, error) => failures.set(method, error),
    put: wrap('put') as BlobStore['put'],
    get: wrap('get') as BlobStore['get'],
    stat: wrap('stat') as BlobStore['stat'],
    delete: wrap('delete') as BlobStore['delete'],
    list: () => {
      calls.list += 1
      return inner.list()
    },
  }
}

const collect = async (store: BlobStore): Promise<BlobStat[]> => {
  const found: BlobStat[] = []
  for await (const stat of store.list()) found.push(stat)
  return found
}

const digestOf = (text: string) => hashBytes(Buffer.from(text))

/** The same store, but its listing leaves out each blob's time, which the interface allows. */
const withoutTimes = (store: BlobStore): BlobStore => ({
  ...store,
  list: async function* () {
    for await (const { sha256, byteSize } of store.list()) yield { sha256, byteSize }
  },
})

describeBlobStoreContract('tiered: a local cache over an object store', async () => {
  const clock = createFakeClock()
  return {
    store: createTieredBlobStore({ cache: await localStore(), backing: objectStore(clock), maxCacheBytes: 1000 }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

describeBlobStoreContract('tiered: a cache too small to hold anything', async () => {
  const clock = createFakeClock()
  return {
    store: createTieredBlobStore({ cache: await localStore(), backing: objectStore(clock), maxCacheBytes: 1 }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

describeBlobStoreContract('mirrored: two object stores', async () => {
  const clock = createFakeClock()
  return {
    store: createMirroredBlobStore({ stores: [objectStore(clock), objectStore(clock)] }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

describeBlobStoreContract('fallback: a primary and a shared read-only store', async () => {
  const clock = createFakeClock()
  return {
    store: createFallbackBlobStore({ primary: objectStore(clock), fallback: objectStore(clock) }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

describeBlobStoreContract('nested: a local cache over a mirror of S3 and Azure, each over a fake service', async () => {
  const clock = createFakeClock()
  const s3 = createFakeS3({ clock, bucket: 'blobs' })
  const azure = createFakeAzure({
    clock,
    accountName: 'acct',
    containerName: 'blobs',
    accountKey: Buffer.alloc(32).toString('base64'),
  })
  const mirror = createMirroredBlobStore({
    stores: [
      createS3BlobStore({
        location: { endpoint: 'https://s3.example.test', region: 'r', addressing: 'path' },
        bucket: 'blobs',
        credentials: { accessKeyId: 'id', secretAccessKey: 'secret' },
        fetch: s3.fetch,
        now: clock.now,
        pageSize: 2,
      }),
      createAzureBlobStore({
        accountName: 'acct',
        containerName: 'blobs',
        accountKey: Buffer.alloc(32).toString('base64'),
        endpoint: 'https://acct.blob.example.test',
        fetch: azure.fetch,
        now: clock.now,
        pageSize: 2,
      }),
    ],
  })
  return {
    store: createTieredBlobStore({ cache: await localStore(), backing: mirror, maxCacheBytes: 100_000 }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

describe('askInOrder', () => {
  it('returns the first answer that is not null and asks no further', async () => {
    const ask = vi.fn(async (store: BlobStore) => (store === second ? 'found' : null))
    const [first, second, third] = [{} as BlobStore, {} as BlobStore, {} as BlobStore]

    expect(await askInOrder([first, second, third], ask)).toBe('found')
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('returns null when every store says it has nothing', async () => {
    expect(await askInOrder([{} as BlobStore, {} as BlobStore], async () => null)).toBeNull()
  })

  it('goes on to the next store after an error, and returns what it finds', async () => {
    const answers = [Promise.reject(new Error('down')), Promise.resolve('found')]

    expect(await askInOrder([{} as BlobStore, {} as BlobStore], () => answers.shift() as Promise<string>)).toBe('found')
    expect(logMock).toHaveBeenCalled()
  })

  it('throws the first error when nothing was found and a store failed, because null would be a guess', async () => {
    const answers = [Promise.reject(new Error('first')), Promise.reject(new Error('second'))]

    await expect(
      askInOrder([{} as BlobStore, {} as BlobStore], () => answers.shift() as Promise<string>),
    ).rejects.toThrow('first')
  })

  it('throws when a store failed and the rest have nothing', async () => {
    const answers = [Promise.reject(new Error('down')), Promise.resolve(null)]

    await expect(
      askInOrder([{} as BlobStore, {} as BlobStore], () => answers.shift() as Promise<string | null>),
    ).rejects.toThrow('down')
  })
})

describe('createTieredBlobStore', () => {
  const build = async (maxCacheBytes: number) => {
    const clock = createFakeClock()
    const cache = spy(await localStore())
    const backing = spy(objectStore(clock))
    return { clock, cache, backing, store: createTieredBlobStore({ cache, backing, maxCacheBytes }) }
  }

  it('fills the cache on a miss and answers the next read from it', async () => {
    const { cache, backing, store } = await build(100)
    const { sha256 } = await backing.put(Buffer.from('from the backing store'))
    backing.calls.put = 0

    expect(await store.get(sha256)).toEqual(Buffer.from('from the backing store'))
    expect(await store.get(sha256)).toEqual(Buffer.from('from the backing store'))

    expect(backing.calls.get).toBe(1)
    expect((await cache.stat(sha256))?.byteSize).toBe(22)
  })

  it('answers null for a blob neither store has, and caches nothing', async () => {
    const { cache, store } = await build(100)

    expect(await store.get(digestOf('absent'))).toBeNull()
    expect(await collect(cache)).toEqual([])
  })

  it('writes to the backing store first and then to the cache', async () => {
    const { cache, backing, store } = await build(100)

    const { sha256 } = await store.put(Buffer.from('written through'))

    expect(await backing.stat(sha256)).not.toBeNull()
    expect(await cache.stat(sha256)).not.toBeNull()
  })

  it('does not cache a blob that alone is larger than the cache, and still stores it', async () => {
    const { cache, backing, store } = await build(5)

    const { sha256 } = await store.put(Buffer.from('longer than five bytes'))

    expect(await cache.stat(sha256)).toBeNull()
    expect(await backing.stat(sha256)).not.toBeNull()
    expect(await store.get(sha256)).toEqual(Buffer.from('longer than five bytes'))
    expect(await cache.stat(sha256)).toBeNull()
  })

  it('deletes the least recently used blobs from the cache once it holds more than its limit', async () => {
    const { cache, backing, store } = await build(10)
    const first = (await store.put(Buffer.from('aaaa'))).sha256
    const second = (await store.put(Buffer.from('bbbb'))).sha256

    const third = (await store.put(Buffer.from('cccc'))).sha256

    expect(await cache.stat(first)).toBeNull()
    expect(await cache.stat(second)).not.toBeNull()
    expect(await cache.stat(third)).not.toBeNull()
    expect(await backing.stat(first)).not.toBeNull()
  })

  it('counts a read as a use, so a blob read recently outlives one written after it', async () => {
    const { cache, store } = await build(10)
    const first = (await store.put(Buffer.from('aaaa'))).sha256
    const second = (await store.put(Buffer.from('bbbb'))).sha256
    await store.get(first)

    await store.put(Buffer.from('cccc'))

    expect(await cache.stat(first)).not.toBeNull()
    expect(await cache.stat(second)).toBeNull()
  })

  it('counts what the cache already holds from before this process, oldest first', async () => {
    const clock = createFakeClock()
    const cache = await localStore()
    const backing = objectStore(clock)
    const older = (await cache.put(Buffer.from('aaaa'))).sha256
    await new Promise((resolve) => setTimeout(resolve, 20))
    const newer = (await cache.put(Buffer.from('bbbb'))).sha256
    const store = createTieredBlobStore({ cache, backing, maxCacheBytes: 10 })

    const added = (await store.put(Buffer.from('cccc'))).sha256

    expect(await cache.stat(older)).toBeNull()
    expect(await cache.stat(newer)).not.toBeNull()
    expect(await cache.stat(added)).not.toBeNull()
  })

  it('treats cached blobs that carry no time as the oldest', async () => {
    const cache = await localStore()
    const older = (await cache.put(Buffer.from('aaaa'))).sha256
    const newer = (await cache.put(Buffer.from('bbbb'))).sha256
    const store = createTieredBlobStore({
      cache: { ...cache, list: () => withoutTimes(cache).list() },
      backing: objectStore(createFakeClock()),
      maxCacheBytes: 10,
    })

    await store.put(Buffer.from('cccc'))

    expect(await cache.stat(older)).toBeNull()
    expect(await cache.stat(newer)).not.toBeNull()
  })

  it('serves a blob that was already in the cache before it was ever read through the store', async () => {
    const cache = await localStore()
    const { sha256 } = await cache.put(Buffer.from('preloaded'))
    const store = createTieredBlobStore({ cache, backing: objectStore(createFakeClock()), maxCacheBytes: 100 })

    expect(await store.get(sha256)).toEqual(Buffer.from('preloaded'))
  })

  it('takes stat and list from the backing store alone', async () => {
    const { cache, backing, store } = await build(100)
    const { sha256 } = await cache.put(Buffer.from('only in the cache'))

    expect(await store.stat(sha256)).toBeNull()
    expect(await collect(store)).toEqual([])
    expect(backing.calls.stat).toBe(1)
    expect(backing.calls.list).toBe(1)
  })

  it('logs and carries on when the cache cannot be filled, and returns the bytes', async () => {
    const { cache, backing, store } = await build(100)
    const { sha256 } = await backing.put(Buffer.from('fill fails'))
    cache.failWith('put', new Error('disk full'))

    expect(await store.get(sha256)).toEqual(Buffer.from('fill fails'))
    expect(await store.put(Buffer.from('write fills nothing'))).toMatchObject({ byteSize: 19 })
    expect(logMock).toHaveBeenCalled()
  })

  it('logs and carries on when trimming the cache fails', async () => {
    const { cache, store } = await build(5)
    await store.put(Buffer.from('aaa'))
    cache.failWith('delete', new Error('cannot delete'))

    await expect(store.put(Buffer.from('bbb'))).resolves.toMatchObject({ byteSize: 3 })
  })

  it('deletes from the backing store and the cache, and answers what the backing store answered', async () => {
    const { cache, backing, store } = await build(100)
    const { sha256 } = await store.put(Buffer.from('delete me'))

    expect(await store.delete(sha256)).toBe(true)

    expect(await cache.stat(sha256)).toBeNull()
    expect(await backing.stat(sha256)).toBeNull()
    expect(await store.delete(sha256)).toBe(false)
  })

  it('leaves the cache alone when the backing store cannot delete', async () => {
    const { cache, backing, store } = await build(100)
    const { sha256 } = await store.put(Buffer.from('still here'))
    backing.failWith('delete', new Error('refused'))

    await expect(store.delete(sha256)).rejects.toThrow('refused')
    expect(await cache.stat(sha256)).not.toBeNull()
  })

  it('logs and carries on when the cached copy cannot be deleted', async () => {
    const { cache, store } = await build(100)
    const { sha256 } = await store.put(Buffer.from('stuck in cache'))
    cache.failWith('delete', new Error('cannot delete'))

    expect(await store.delete(sha256)).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses a cache size of %s', async (size) => {
    const clock = createFakeClock()

    expect(() =>
      createTieredBlobStore({ cache: objectStore(clock), backing: objectStore(clock), maxCacheBytes: size }),
    ).toThrow(ImageStoreConfigurationError)
  })
})

describe('createMirroredBlobStore', () => {
  const build = (minimumWrites?: number) => {
    const clock = createFakeClock()
    const first = spy(objectStore(clock))
    const second = spy(objectStore(clock))
    return { clock, first, second, store: createMirroredBlobStore({ stores: [first, second], minimumWrites }) }
  }

  it('writes every blob to every store', async () => {
    const { first, second, store } = build()

    const { sha256 } = await store.put(Buffer.from('everywhere'))

    expect(await first.stat(sha256)).not.toBeNull()
    expect(await second.stat(sha256)).not.toBeNull()
  })

  it('fails a write that one store refuses, by default, and says which count was short', async () => {
    const { first, second, store } = build()
    second.failWith('put', new Error('bucket offline'))

    const error = await store.put(Buffer.from('half written')).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(BlobStoreError)
    expect(error.message).toBe('mirrored put: 1 of 2 stores accepted the blob, 2 needed')
    expect(error.cause.message).toBe('bucket offline')
    expect(await first.stat(digestOf('half written'))).not.toBeNull()
  })

  it('accepts a write that enough stores took when minimumWrites is lower, and logs the failure', async () => {
    const { second, store } = build(1)
    second.failWith('put', new Error('bucket offline'))

    expect(await store.put(Buffer.from('one is enough'))).toMatchObject({ byteSize: 13 })
    expect(logMock).toHaveBeenCalled()
  })

  it('reads from the first store that has the blob, and from the next when the first has not', async () => {
    const { first, second, store } = build()
    const { sha256 } = await second.put(Buffer.from('only in the second'))

    expect(await store.get(sha256)).toEqual(Buffer.from('only in the second'))
    expect(await store.stat(sha256)).toMatchObject({ byteSize: 18 })
    expect(first.calls.get).toBe(1)
  })

  it('reads from the second store when the first fails', async () => {
    const { first, second, store } = build()
    const { sha256 } = await second.put(Buffer.from('still readable'))
    first.failWith('get', new Error('first is down'))
    first.failWith('stat', new Error('first is down'))

    expect(await store.get(sha256)).toEqual(Buffer.from('still readable'))
    expect(await store.stat(sha256)).toMatchObject({ byteSize: 14 })
  })

  it('refuses to call a blob missing when a store that might have it could not answer', async () => {
    const { first, store } = build()
    first.failWith('get', new Error('first is down'))

    await expect(store.get(digestOf('who knows'))).rejects.toThrow('first is down')
  })

  it('deletes from every store and says true when any had the blob', async () => {
    const { first, second, store } = build()
    const { sha256 } = await second.put(Buffer.from('in one store'))

    expect(await store.delete(sha256)).toBe(true)

    expect(await second.stat(sha256)).toBeNull()
    expect(await store.delete(sha256)).toBe(false)
    expect(first.calls.delete).toBe(2)
  })

  it('still deletes from the other stores when one fails, and then reports the failure', async () => {
    const { first, second, store } = build()
    const { sha256 } = await store.put(Buffer.from('partly deleted'))
    first.failWith('delete', new Error('first refuses'))

    await expect(store.delete(sha256)).rejects.toThrow('first refuses')
    expect(await second.stat(sha256)).toBeNull()
  })

  it('lists the union once per blob, with the newest modification time any store gave it', async () => {
    const { clock, first, second, store } = build()
    await first.put(Buffer.from('shared'))
    await first.put(Buffer.from('first only'))
    clock.advance(1000)
    await second.put(Buffer.from('shared'))
    await second.put(Buffer.from('second only'))
    await second.put(Buffer.from('first only'))
    clock.advance(1000)
    await first.put(Buffer.from('first only'))

    const listed = await collect(store)

    expect(listed.map((stat) => stat.sha256).sort()).toEqual(
      ['shared', 'first only', 'second only'].map(digestOf).sort(),
    )
    const byDigest = new Map(listed.map((stat) => [stat.sha256, stat.modifiedAtMs]))
    expect(byDigest.get(digestOf('shared'))).toBe(clock.now() - 1000)
    expect(byDigest.get(digestOf('first only'))).toBe(clock.now())
  })

  it('keeps the entry from the first store when a later store has an older time', async () => {
    const { clock, first, second, store } = build()
    await second.put(Buffer.from('shared'))
    clock.advance(1000)
    await first.put(Buffer.from('shared'))

    const [only] = await collect(store)

    expect(only.modifiedAtMs).toBe(clock.now())
  })

  it('prefers an entry that has a time over one that has none, in either order', async () => {
    const { clock, first, second } = build()
    await first.put(Buffer.from('shared'))
    await second.put(Buffer.from('shared'))
    clock.advance(1000)
    const timed = createMirroredBlobStore({ stores: [withoutTimes(first), second] })
    const untimed = createMirroredBlobStore({ stores: [first, withoutTimes(second)] })

    expect((await collect(timed))[0].modifiedAtMs).toBe(clock.now() - 1000)
    expect((await collect(untimed))[0].modifiedAtMs).toBe(clock.now() - 1000)
  })

  it('refuses a mirror with no stores, or with minimumWrites out of range', () => {
    const clock = createFakeClock()
    const stores = [objectStore(clock), objectStore(clock)]

    expect(() => createMirroredBlobStore({ stores: [] })).toThrow(ImageStoreConfigurationError)
    for (const minimumWrites of [0, 3, 1.5]) {
      expect(() => createMirroredBlobStore({ stores, minimumWrites })).toThrow(/from 1 to 2/)
    }
  })
})

describe('createFallbackBlobStore', () => {
  const build = () => {
    const clock = createFakeClock()
    const primary = spy(objectStore(clock))
    const shared = spy(objectStore(clock))
    return { primary, shared, store: createFallbackBlobStore({ primary, fallback: shared }) }
  }

  it('reads from the primary first, then from the shared store', async () => {
    const { primary, shared, store } = build()
    const own = (await primary.put(Buffer.from('own'))).sha256
    const borrowed = (await shared.put(Buffer.from('borrowed'))).sha256

    expect(await store.get(own)).toEqual(Buffer.from('own'))
    expect(shared.calls.get).toBe(0)
    expect(await store.get(borrowed)).toEqual(Buffer.from('borrowed'))
    expect(await store.stat(borrowed)).toMatchObject({ byteSize: 8 })
    expect(await store.get(digestOf('nowhere'))).toBeNull()
  })

  it('writes only to the primary', async () => {
    const { primary, shared, store } = build()

    const { sha256 } = await store.put(Buffer.from('mine'))

    expect(await primary.stat(sha256)).not.toBeNull()
    expect(shared.calls.put).toBe(0)
  })

  it('never deletes from, or lists, the shared store, so gc here cannot touch it', async () => {
    const { primary, shared, store } = build()
    const borrowed = (await shared.put(Buffer.from('borrowed'))).sha256
    const own = (await primary.put(Buffer.from('own'))).sha256

    expect(await store.delete(borrowed)).toBe(false)
    expect(await store.delete(own)).toBe(true)
    expect(await collect(store)).toEqual([])
    expect(await shared.stat(borrowed)).not.toBeNull()
    expect(shared.calls.delete).toBe(0)
    expect(shared.calls.list).toBe(0)
  })
})
