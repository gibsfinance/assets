import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { createFakeAzure } from './__testing__/fake-azure'
import { createFakeClock } from './__testing__/fake-clock'
import {
  AZURE_API_VERSION,
  buildSharedKeyStringToSign,
  createAzureBlobStore,
  createAzureObjectClient,
  signSharedKey,
} from './azure'
import { ImageStoreConfigurationError } from './configuration-error'
import { hashBytes } from './hash'
import { BlobStoreError } from './http'

vi.mock('../logger', () => ({ log: vi.fn() }))

/** A made-up account key: 64 bytes in base64, the length of a real one. */
const ACCOUNT_KEY = Buffer.alloc(64, 'azure-test-key-').toString('base64')
const SAS_TOKEN = '?sv=2021-08-06&sp=racwdl&sig=abc%2Bdef%3D'
const noSleep = async () => undefined

const build = (settings: { auth?: 'key' | 'sas'; keyPrefix?: string; retries?: number } = {}) => {
  const clock = createFakeClock()
  const auth = settings.auth ?? 'key'
  const service = createFakeAzure({
    clock,
    accountName: 'testaccount',
    containerName: 'blobs',
    accountKey: auth === 'key' ? ACCOUNT_KEY : undefined,
    sasToken: auth === 'sas' ? SAS_TOKEN : undefined,
  })
  const common = {
    accountName: 'testaccount',
    containerName: 'blobs',
    endpoint: 'https://testaccount.blob.example.test',
    accountKey: auth === 'key' ? ACCOUNT_KEY : undefined,
    sasToken: auth === 'sas' ? SAS_TOKEN : undefined,
    fetch: service.fetch,
    now: clock.now,
    sleep: noSleep,
    pageSize: 3,
    retries: settings.retries,
  }
  return { clock, service, common, store: createAzureBlobStore({ ...common, keyPrefix: settings.keyPrefix }) }
}

for (const [label, settings] of [
  ['Shared Key', { auth: 'key' }],
  ['a SAS token', { auth: 'sas' }],
  ['a key prefix', { auth: 'key', keyPrefix: 'images/' }],
] as const) {
  describeBlobStoreContract(`Azure Blob Storage over a fake service, ${label}`, async () => {
    const { clock, store } = build(settings)
    return { store, clock: clock.now, advanceClock: async () => clock.advance(60_000) }
  })
}

describe('buildSharedKeyStringToSign, against the example in the Azure documentation ("Authorize with Shared Key")', () => {
  const documented =
    'GET\n\n\n\n\n\n\n\n\n\n\n\nx-ms-date:Fri, 26 Jun 2015 23:39:12 GMT\nx-ms-version:2015-02-21\n/myaccount/mycontainer\ncomp:metadata\nrestype:container\ntimeout:20'

  it('builds the string the documentation prints for a container metadata request', () => {
    expect(
      buildSharedKeyStringToSign({
        method: 'GET',
        url: new URL('https://myaccount.blob.core.windows.net/mycontainer?restype=container&comp=metadata&timeout=20'),
        headers: { 'x-ms-date': 'Fri, 26 Jun 2015 23:39:12 GMT', 'x-ms-version': '2015-02-21' },
        contentLength: 0,
        accountName: 'myaccount',
      }),
    ).toBe(documented)
  })

  it('signs that string with HMAC-SHA256 under the decoded account key', () => {
    const request = {
      method: 'GET',
      url: new URL('https://myaccount.blob.core.windows.net/mycontainer?restype=container&comp=metadata&timeout=20'),
      headers: { 'x-ms-date': 'Fri, 26 Jun 2015 23:39:12 GMT', 'x-ms-version': '2015-02-21' },
      contentLength: 0,
      accountName: 'myaccount',
    }
    const expected = createHmac('sha256', Buffer.from(ACCOUNT_KEY, 'base64')).update(documented).digest('base64')

    expect(signSharedKey(request, ACCOUNT_KEY)).toBe(`SharedKey myaccount:${expected}`)
  })
})

describe('buildSharedKeyStringToSign, beyond the documented example', () => {
  const base = {
    method: 'put',
    url: new URL('https://acct.blob.core.windows.net/c/sha256/ab/abcd'),
    headers: {} as Record<string, string>,
    contentLength: 0,
    accountName: 'acct',
  }

  it('signs a body length as text, and a zero length as nothing', () => {
    const withBody = buildSharedKeyStringToSign({ ...base, contentLength: 1234 }).split('\n')
    const without = buildSharedKeyStringToSign(base).split('\n')

    expect(withBody[3]).toBe('1234')
    expect(without[3]).toBe('')
    expect(withBody[0]).toBe('PUT')
  })

  it('puts the standard headers in their fixed places, whatever the case they were sent in', () => {
    const lines = buildSharedKeyStringToSign({
      ...base,
      headers: { 'Content-Type': 'application/octet-stream', Range: 'bytes=0-9', 'If-Match': '"tag"' },
    }).split('\n')

    expect(lines[5]).toBe('application/octet-stream')
    expect(lines[8]).toBe('"tag"')
    expect(lines[11]).toBe('bytes=0-9')
  })

  it('sorts and trims the x-ms headers and leaves the others out of the canonical block', () => {
    const lines = buildSharedKeyStringToSign({
      ...base,
      headers: { 'x-ms-version': ' v ', 'X-Ms-Blob-Type': 'BlockBlob', 'x-custom': 'ignored' },
    })

    expect(lines).toContain('x-ms-blob-type:BlockBlob\nx-ms-version:v\n/acct/c/sha256/ab/abcd')
    expect(lines).not.toContain('ignored')
  })

  it('lowercases query names, sorts them, and joins repeated values with commas in order', () => {
    const text = buildSharedKeyStringToSign({
      ...base,
      url: new URL('https://acct.blob.core.windows.net/c?Restype=container&comp=list&include=b&include=a'),
    })

    expect(text.endsWith('/acct/c\ncomp:list\ninclude:a,b\nrestype:container')).toBe(true)
  })

  it('names the account twice for an emulator, whose address has the account in its path', () => {
    const text = buildSharedKeyStringToSign({
      ...base,
      url: new URL('http://127.0.0.1:10000/devstoreaccount1/c/blob'),
      accountName: 'devstoreaccount1',
    })

    expect(text.endsWith('/devstoreaccount1/devstoreaccount1/c/blob')).toBe(true)
  })
})

describe('Azure requests', () => {
  it('addresses a blob as <container>/sha256/<shard>/<digest> and writes it as a block blob', async () => {
    const { service, store } = build()
    const { sha256 } = await store.put(Buffer.from('where am I'))
    const url = `https://testaccount.blob.example.test/blobs/sha256/${sha256.slice(0, 2)}/${sha256}`

    expect(service.requests).toEqual([`HEAD ${url}`, `PUT ${url}`])
  })

  it('names the service version in every request', async () => {
    const { common } = build()
    const seen: string[] = []
    const store = createAzureBlobStore({
      ...common,
      fetch: async (input, init) => {
        seen.push(new Headers(init?.headers).get('x-ms-version') as string)
        return new Response(null, { status: 404 })
      },
    })

    await store.get(hashBytes(Buffer.from('x')))

    expect(seen).toEqual([AZURE_API_VERSION])
  })

  it('adds the SAS token to the address, with its characters intact, and sends no signature', async () => {
    const { service, store } = build({ auth: 'sas' })
    await store.stat(hashBytes(Buffer.from('x')))

    expect(service.requests[0]).toContain('?sv=2021-08-06&sp=racwdl&sig=abc%2Bdef%3D')
  })

  it('asks again after a busy answer', async () => {
    const { service, store } = build()
    service.failNext(503, 2)

    expect(await store.stat(hashBytes(Buffer.from('x')))).toBeNull()
    expect(service.requests).toHaveLength(3)
  })

  it.each([
    ['get', (store: ReturnType<typeof build>['store']) => store.get(hashBytes(Buffer.from('x')))],
    ['stat', (store: ReturnType<typeof build>['store']) => store.stat(hashBytes(Buffer.from('x')))],
    ['put', (store: ReturnType<typeof build>['store']) => store.put(Buffer.from('x'))],
  ])('reports a refusal to %s as an error', async (_name, operation) => {
    const { common } = build({ retries: 0 })
    const refusing = createAzureBlobStore({ ...common, fetch: async () => new Response('denied', { status: 403 }) })

    await expect(operation(refusing)).rejects.toBeInstanceOf(BlobStoreError)
  })

  it('reports a refusal to delete, list and renew as an error', async () => {
    const { common } = build({ retries: 0 })
    const refusing = createAzureObjectClient({ ...common, fetch: async () => new Response('denied', { status: 403 }) })

    await expect(refusing.remove('k')).rejects.toBeInstanceOf(BlobStoreError)
    await expect(refusing.renew('k')).rejects.toBeInstanceOf(BlobStoreError)
    await expect(refusing.list('p')[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(BlobStoreError)
  })

  it('refuses a head answer that has no modification time', async () => {
    const { common } = build()
    const client = createAzureObjectClient({
      ...common,
      fetch: async () => new Response(null, { status: 200, headers: { 'content-length': '3' } }),
    })

    await expect(client.head('k')).rejects.toThrow(/no usable modification time/)
  })

  it('uses the global fetch and clock when none are given', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))
    const store = createAzureBlobStore({ accountName: 'a', containerName: 'c', accountKey: ACCOUNT_KEY })

    expect(await store.stat(hashBytes(Buffer.from('x')))).toBeNull()
    expect(String(globalFetch.mock.calls[0][0])).toMatch(/^https:\/\/a\.blob\.core\.windows\.net\/c\/sha256\//)
    globalFetch.mockRestore()
  })

  it.each([
    ['neither', {}],
    ['both', { accountKey: ACCOUNT_KEY, sasToken: SAS_TOKEN }],
  ])('refuses to start with %s of an account key and a SAS token', (_label, credentials) => {
    expect(() => createAzureObjectClient({ accountName: 'a', containerName: 'c', ...credentials })).toThrow(
      ImageStoreConfigurationError,
    )
  })
})
