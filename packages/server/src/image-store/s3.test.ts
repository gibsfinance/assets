import { describe, expect, it, vi } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { createFakeClock } from './__testing__/fake-clock'
import { createFakeS3 } from './__testing__/fake-s3'
import { hashBytes } from './hash'
import { BlobStoreError } from './http'
import { ImageStoreConfigurationError } from './configuration-error'
import { createS3BlobStore, createS3ObjectClient, resolveS3Location, S3_PRESET_NAMES } from './s3'

vi.mock('../logger', () => ({ log: vi.fn() }))

const CREDENTIALS = { accessKeyId: 'test-key-id', secretAccessKey: 'test-secret' }
const noSleep = async () => undefined

const build = (
  settings: { virtualHosted?: boolean; keyPrefix?: string; retries?: number } = {},
  location = { endpoint: 'https://s3.example.test', region: 'test-region', addressing: 'path' as const },
) => {
  const clock = createFakeClock()
  const service = createFakeS3({ clock, bucket: 'blobs', virtualHosted: settings.virtualHosted })
  const store = createS3BlobStore({
    location: settings.virtualHosted ? { ...location, addressing: 'virtual' } : location,
    bucket: 'blobs',
    credentials: CREDENTIALS,
    fetch: service.fetch,
    now: clock.now,
    sleep: noSleep,
    pageSize: 3,
    keyPrefix: settings.keyPrefix,
    retries: settings.retries,
  })
  return { clock, service, store }
}

for (const [label, settings] of [
  ['path-style addressing', {}],
  ['virtual-hosted addressing', { virtualHosted: true }],
  ['a key prefix', { keyPrefix: 'images/v1/' }],
] as const) {
  describeBlobStoreContract(`S3 over a fake service, ${label}`, async () => {
    const { clock, store } = build(settings)
    return { store, clock: clock.now, advanceClock: async () => clock.advance(60_000) }
  })
}

describe('S3 requests', () => {
  it('addresses a blob as <bucket>/sha256/<shard>/<digest> in path style', async () => {
    const { service, store } = build()
    const { sha256 } = await store.put(Buffer.from('where am I'))

    expect(service.requests.map((request) => `${request.method} ${request.url.href}`)).toEqual([
      `HEAD https://s3.example.test/blobs/sha256/${sha256.slice(0, 2)}/${sha256}`,
      `PUT https://s3.example.test/blobs/sha256/${sha256.slice(0, 2)}/${sha256}`,
    ])
  })

  it('puts the bucket in the host in virtual-hosted style', async () => {
    const { service, store } = build({ virtualHosted: true })
    const { sha256 } = await store.put(Buffer.from('where am I'))

    expect(service.requests[1].url.href).toBe(`https://blobs.s3.example.test/sha256/${sha256.slice(0, 2)}/${sha256}`)
  })

  it('signs every request, with a date from its own clock', async () => {
    const { service, store } = build()
    await store.put(Buffer.from('signed'))

    for (const request of service.requests) {
      expect(request.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=test-key-id\/20261111\/test-region\/s3\/aws4_request/,
      )
    }
  })

  it('sends the digest of the bytes it writes as the payload hash', async () => {
    const { service, store } = build()
    const bytes = Buffer.from('payload')
    await store.put(bytes)

    expect(service.requests[1].headers.get('x-amz-content-sha256')).toBe(hashBytes(bytes))
  })

  it('percent-encodes a key prefix that holds awkward characters', async () => {
    const { service, store } = build({ keyPrefix: "my images/it's/" })
    const { sha256 } = await store.put(Buffer.from('awkward'))

    expect(service.requests[1].url.pathname).toBe(`/blobs/my%20images/it%27s/sha256/${sha256.slice(0, 2)}/${sha256}`)
    expect(await store.get(sha256)).toEqual(Buffer.from('awkward'))
  })

  it('asks again after a throttled answer, and signs the new attempt afresh', async () => {
    const { service, store, clock } = build()
    const sleep = vi.fn(async () => clock.advance(1))
    const client = createS3ObjectClient({
      location: { endpoint: 'https://s3.example.test', region: 'test-region', addressing: 'path' },
      bucket: 'blobs',
      credentials: CREDENTIALS,
      fetch: service.fetch,
      now: clock.now,
      sleep,
    })
    service.failNext(503, 2)
    // The fake checks `x-amz-date` against its clock, so an attempt signed with a stale date would fail.

    await client.put('k', Buffer.from('v'))

    expect(sleep).toHaveBeenCalledTimes(2)
    expect(service.objects.get('k')?.bytes).toEqual(Buffer.from('v'))
    expect(store).toBeDefined()
  })

  it('reports a 403 on read as an error, never as a missing blob', async () => {
    const { service, store } = build({ retries: 0 })
    service.failNext(403)

    await expect(store.get(hashBytes(Buffer.from('x')))).rejects.toMatchObject({ name: 'BlobStoreError', status: 403 })
  })

  it('reports a failed head, delete and listing as errors', async () => {
    const { service, store } = build({ retries: 0 })
    const digest = hashBytes(Buffer.from('x'))

    service.failNext(403)
    await expect(store.stat(digest)).rejects.toBeInstanceOf(BlobStoreError)
    service.failNext(403, 2)
    await expect(store.delete(digest)).rejects.toBeInstanceOf(BlobStoreError)
    service.failNext(403)
    await expect(store.list()[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(BlobStoreError)
  })

  it('reports a failed write as an error', async () => {
    const { service, store } = build({ retries: 0 })
    service.failNext(403, 2)

    await expect(store.put(Buffer.from('nope'))).rejects.toBeInstanceOf(BlobStoreError)
  })

  it('refuses a head answer that has no modification time', async () => {
    const client = createS3ObjectClient({
      location: { endpoint: 'https://s3.example.test', region: 'r', addressing: 'path' },
      bucket: 'blobs',
      credentials: CREDENTIALS,
      fetch: async () => new Response(null, { status: 200, headers: { 'content-length': '3' } }),
    })

    await expect(client.head('k')).rejects.toThrow(/no usable modification time/)
  })

  it('writes the bytes again when the service cannot copy an object onto itself', async () => {
    const { service, store, clock } = build({ retries: 0 })
    const bytes = Buffer.from('copy refused')
    await store.put(bytes)
    clock.advance(60_000)
    service.setCopyBehavior('unsupported')

    await store.put(bytes)

    expect((await store.stat(hashBytes(bytes)))?.modifiedAtMs).toBe(clock.now())
  })

  it('treats an error inside a 200 answer to a copy as a failed copy', async () => {
    const { service, store, clock } = build()
    const bytes = Buffer.from('error in the body')
    await store.put(bytes)
    clock.advance(60_000)
    service.setCopyBehavior('fails-inside-a-200')

    await store.put(bytes)

    expect((await store.stat(hashBytes(bytes)))?.modifiedAtMs).toBe(clock.now())
  })

  it('stops with an error when a listing is cut off and names no way on', async () => {
    const { service, store } = build()
    for (const text of ['a', 'b', 'c', 'd']) await store.put(Buffer.from(text))
    service.breakPaging()

    await expect(async () => {
      for await (const stat of store.list()) void stat
    }).rejects.toThrow(/continuation token/)
  })

  it('sends the session token of temporary credentials', async () => {
    const clock = createFakeClock()
    const service = createFakeS3({ clock, bucket: 'blobs' })
    const store = createS3BlobStore({
      location: { endpoint: 'https://s3.example.test', region: 'r', addressing: 'path' },
      bucket: 'blobs',
      credentials: { ...CREDENTIALS, sessionToken: 'temporary' },
      fetch: service.fetch,
      now: clock.now,
    })

    await store.stat(hashBytes(Buffer.from('x')))

    expect(service.requests[0].headers.get('x-amz-security-token')).toBe('temporary')
  })

  it('uses the global fetch and clock when none are given', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    const store = createS3BlobStore({
      location: { endpoint: 'https://s3.example.test', region: 'r', addressing: 'path' },
      bucket: 'blobs',
      credentials: CREDENTIALS,
    })

    expect(await store.stat(hashBytes(Buffer.from('x')))).toBeNull()
    expect(globalFetch).toHaveBeenCalledTimes(1)
    globalFetch.mockRestore()
  })
})

describe('resolveS3Location', () => {
  it.each([
    ['aws', { region: 'eu-west-1' }, 'https://s3.eu-west-1.amazonaws.com', 'eu-west-1', 'virtual'],
    ['aws', {}, 'https://s3.us-east-1.amazonaws.com', 'us-east-1', 'virtual'],
    ['r2', { accountId: 'abc123' }, 'https://abc123.r2.cloudflarestorage.com', 'auto', 'path'],
    ['hetzner', {}, 'https://fsn1.your-objectstorage.com', 'fsn1', 'path'],
    ['hetzner', { region: 'nbg1' }, 'https://nbg1.your-objectstorage.com', 'nbg1', 'path'],
    ['b2', { region: 'us-west-004' }, 'https://s3.us-west-004.backblazeb2.com', 'us-west-004', 'path'],
    ['wasabi', {}, 'https://s3.us-east-1.wasabisys.com', 'us-east-1', 'path'],
    ['wasabi', { region: 'eu-central-1' }, 'https://s3.eu-central-1.wasabisys.com', 'eu-central-1', 'path'],
    ['spaces', {}, 'https://nyc3.digitaloceanspaces.com', 'nyc3', 'virtual'],
    ['spaces', { region: 'fra1' }, 'https://fra1.digitaloceanspaces.com', 'fra1', 'virtual'],
    ['minio', { endpoint: 'http://localhost:9000' }, 'http://localhost:9000', 'us-east-1', 'path'],
    [
      'custom',
      { endpoint: 'https://objects.example.test:8443/ignored' },
      'https://objects.example.test:8443',
      'us-east-1',
      'path',
    ],
  ] as const)('gives the %s preset the right endpoint for %j', (preset, input, endpoint, region, addressing) => {
    expect(resolveS3Location({ preset, ...input })).toEqual({ endpoint, region, addressing })
  })

  it('lets an explicit endpoint and addressing override the preset', () => {
    expect(
      resolveS3Location({ preset: 'aws', endpoint: 'https://s3.private.test', addressing: 'path', region: 'x' }),
    ).toEqual({ endpoint: 'https://s3.private.test', region: 'x', addressing: 'path' })
  })

  it('names every preset the settings table promises', () => {
    expect(S3_PRESET_NAMES).toEqual(['aws', 'r2', 'hetzner', 'b2', 'wasabi', 'spaces', 'minio', 'custom'])
  })

  it.each([
    ['b2 without a region', { preset: 'b2' }, /needs a region/],
    ['r2 without an account id', { preset: 'r2' }, /needs an account id/],
    ['minio without an endpoint', { preset: 'minio' }, /needs an endpoint/],
    ['an endpoint that is not an address', { preset: 'custom', endpoint: 'not a url' }, /not a web address/],
    ['an endpoint with another scheme', { preset: 'custom', endpoint: 'ftp://host' }, /https:\/\/ or http:\/\//],
  ] as const)('refuses %s', (_label, input, message) => {
    expect(() => resolveS3Location(input)).toThrow(ImageStoreConfigurationError)
    expect(() => resolveS3Location(input)).toThrow(message)
  })
})
