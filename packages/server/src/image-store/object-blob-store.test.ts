import { describe, expect, it, vi } from 'vitest'
import { createFakeClock } from './__testing__/fake-clock'
import { createMemoryObjectClient } from './__testing__/memory-object-client'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { hashBytes } from './hash'
import { createObjectBlobStore, digestOfObjectKey, objectKeyOf } from './object-blob-store'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('../logger', () => ({ log: logMock }))

describeBlobStoreContract('object layer over an in-memory client', async () => {
  const clock = createFakeClock()
  return {
    store: createObjectBlobStore({ client: createMemoryObjectClient(clock) }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

describeBlobStoreContract('object layer with a key prefix', async () => {
  const clock = createFakeClock()
  return {
    store: createObjectBlobStore({ client: createMemoryObjectClient(clock), keyPrefix: 'images/' }),
    clock: clock.now,
    advanceClock: async () => clock.advance(60_000),
  }
})

const DIGEST = 'ab'.repeat(32)

describe('objectKeyOf', () => {
  it('lays the key out as sha256/<first two hex>/<digest>, after an optional prefix', () => {
    expect(objectKeyOf(DIGEST)).toBe(`sha256/ab/${DIGEST}`)
    expect(objectKeyOf(DIGEST, 'images/')).toBe(`images/sha256/ab/${DIGEST}`)
  })

  it('refuses a malformed digest', () => {
    expect(() => objectKeyOf('../x')).toThrow(TypeError)
  })
})

describe('digestOfObjectKey', () => {
  it('reads the digest back out of a key the store wrote', () => {
    expect(digestOfObjectKey(`sha256/ab/${DIGEST}`)).toBe(DIGEST)
    expect(digestOfObjectKey(`images/sha256/ab/${DIGEST}`, 'images/')).toBe(DIGEST)
  })

  it.each([
    ['another prefix', `other/sha256/ab/${DIGEST}`],
    ['a shard that is not the digest start', `sha256/cd/${DIGEST}`],
    ['a name that is not a digest', 'sha256/ab/notadigest'],
    ['a deeper path', `sha256/ab/${DIGEST}/extra`],
    ['no shard at all', `sha256/${DIGEST}`],
    ['the directory itself', 'sha256/'],
  ])('refuses %s', (_label, key) => {
    expect(digestOfObjectKey(key)).toBeNull()
  })
})

describe('createObjectBlobStore', () => {
  it('sends nothing but a renewal when the blob is already stored', async () => {
    const clock = createFakeClock()
    const client = createMemoryObjectClient(clock)
    const store = createObjectBlobStore({ client })
    const bytes = Buffer.from('already here')
    await store.put(bytes)
    client.puts.length = 0

    await store.put(bytes)

    expect(client.puts).toEqual([])
  })

  it('writes the bytes again when the service refuses a renewal', async () => {
    const clock = createFakeClock()
    const client = createMemoryObjectClient(clock)
    const store = createObjectBlobStore({ client })
    const bytes = Buffer.from('refused renewal')
    await store.put(bytes)
    clock.advance(60_000)
    client.failRenewals()

    await store.put(bytes)

    expect(client.puts).toHaveLength(2)
    expect((await store.stat(hashBytes(bytes)))?.modifiedAtMs).toBe(clock.now())
    expect(logMock).toHaveBeenCalled()
  })

  it('replaces an object whose length does not match the bytes', async () => {
    const client = createMemoryObjectClient(createFakeClock())
    const store = createObjectBlobStore({ client })
    const bytes = Buffer.from('the real content')
    client.objects.set(objectKeyOf(hashBytes(bytes)), { bytes: Buffer.from('trunc'), modifiedAtMs: 0 })

    await store.put(bytes)

    expect(await store.get(hashBytes(bytes))).toEqual(bytes)
  })

  it('leaves out of its listing whatever it did not write', async () => {
    const client = createMemoryObjectClient(createFakeClock())
    const store = createObjectBlobStore({ client })
    await client.put('sha256/stray.txt', Buffer.from('x'))
    await client.put('sha256/ab/readme', Buffer.from('x'))
    const { sha256 } = await store.put(Buffer.from('ours'))

    const listed: string[] = []
    for await (const found of store.list()) listed.push(found.sha256)

    expect(listed).toEqual([sha256])
  })

  it('keeps two stores with different prefixes apart', async () => {
    const client = createMemoryObjectClient(createFakeClock())
    const first = createObjectBlobStore({ client, keyPrefix: 'a/' })
    const second = createObjectBlobStore({ client, keyPrefix: 'b/' })
    const { sha256 } = await first.put(Buffer.from('only in a'))

    expect(await second.get(sha256)).toBeNull()
    expect(await second.delete(sha256)).toBe(false)
  })
})
