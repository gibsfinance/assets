import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { describeBlobStoreContract } from './__testing__/blob-store-contract'
import { createFakeClock } from './__testing__/fake-clock'
import { createFakeGcs } from './__testing__/fake-gcs'
import { ImageStoreConfigurationError } from './configuration-error'
import {
  buildTokenRequestBody,
  createGcsBlobStore,
  createGcsObjectClient,
  GCS_DEFAULT_ENDPOINT,
  GOOGLE_TOKEN_URI,
  parseGcsCredentials,
} from './gcs'
import { hashBytes } from './hash'
import { BlobStoreError } from './http'

vi.mock('../logger', () => ({ log: vi.fn() }))

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
const CLIENT_EMAIL = 'images@project.iam.example.test'
const TOKEN_URI = 'https://token.example.test/token'
const ENDPOINT = 'https://gcs.example.test'
const ACCOUNT = { client_email: CLIENT_EMAIL, private_key: privateKey, token_uri: TOKEN_URI }
const noSleep = async () => undefined

const build = (settings: { anonymous?: boolean; keyPrefix?: string; endpoint?: string; retries?: number } = {}) => {
  const clock = createFakeClock()
  const service = createFakeGcs({
    clock,
    bucket: 'blobs',
    publicKey,
    clientEmail: CLIENT_EMAIL,
    tokenUri: TOKEN_URI,
    endpoint: ENDPOINT,
    requireToken: !settings.anonymous,
  })
  const common = {
    bucket: 'blobs',
    endpoint: settings.endpoint ?? ENDPOINT,
    credentials: settings.anonymous ? undefined : ACCOUNT,
    fetch: service.fetch,
    now: clock.now,
    sleep: noSleep,
    pageSize: 3,
    retries: settings.retries,
  }
  return {
    clock,
    service,
    common,
    store: createGcsBlobStore({ ...common, keyPrefix: settings.keyPrefix }),
  }
}

for (const [label, settings] of [
  ['service-account sign-in', {}],
  ['an emulator with no sign-in', { anonymous: true }],
  ['a key prefix and a trailing slash on the endpoint', { keyPrefix: 'images/', endpoint: `${ENDPOINT}//` }],
] as const) {
  describeBlobStoreContract(`Google Cloud Storage over a fake service, ${label}`, async () => {
    const { clock, store } = build(settings)
    return { store, clock: clock.now, advanceClock: async () => clock.advance(60_000) }
  })
}

describe('Google Cloud Storage requests', () => {
  it('addresses an object by its whole name, slashes encoded, in the JSON API', async () => {
    const { service, store } = build()
    const { sha256 } = await store.put(Buffer.from('where am I'))
    const name = encodeURIComponent(`sha256/${sha256.slice(0, 2)}/${sha256}`)

    expect(service.requests).toEqual([
      `POST ${TOKEN_URI}`,
      `GET ${ENDPOINT}/storage/v1/b/blobs/o/${name}`,
      `POST ${ENDPOINT}/upload/storage/v1/b/blobs/o?uploadType=media&name=${name}`,
    ])
  })

  it('signs in once and reuses the token', async () => {
    const { service, store } = build()

    await store.put(Buffer.from('one'))
    await store.put(Buffer.from('two'))

    expect(service.tokensIssued()).toBe(1)
  })

  it('shares one token request between calls that start together', async () => {
    const { service, store } = build()

    await Promise.all([1, 2, 3].map((number) => store.put(Buffer.from(`blob ${number}`))))

    expect(service.tokensIssued()).toBe(1)
  })

  it('signs in again a minute before the token expires', async () => {
    const { service, store, clock } = build()
    service.setTokenLifetime(600)
    await store.stat(hashBytes(Buffer.from('x')))

    clock.advance(539_000)
    await store.stat(hashBytes(Buffer.from('x')))
    expect(service.tokensIssued()).toBe(1)

    clock.advance(1_000)
    await store.stat(hashBytes(Buffer.from('x')))
    expect(service.tokensIssued()).toBe(2)
  })

  it('assumes an hour when the token answer gives no lifetime', async () => {
    const { service, store, clock } = build()
    service.setTokenLifetime(undefined)
    await store.stat(hashBytes(Buffer.from('x')))

    clock.advance(3_539_000)
    await store.stat(hashBytes(Buffer.from('x')))

    expect(service.tokensIssued()).toBe(1)
  })

  it('stops with an error when sign-in is refused, and tries again on the next call', async () => {
    const { service, store } = build({ retries: 0 })
    service.failNextTokenRequest(400)

    await expect(store.stat(hashBytes(Buffer.from('x')))).rejects.toMatchObject({ status: 400 })
    expect(await store.stat(hashBytes(Buffer.from('x')))).toBeNull()
  })

  it('stops with an error when the token answer has no token', async () => {
    const { service, store } = build({ retries: 0 })
    service.answerNextTokenRequestEmpty()

    await expect(store.stat(hashBytes(Buffer.from('x')))).rejects.toThrow(/without a token/)
  })

  it('uses the default token address when the key file names none', async () => {
    const clock = createFakeClock()
    const service = createFakeGcs({
      clock,
      bucket: 'blobs',
      publicKey,
      clientEmail: CLIENT_EMAIL,
      tokenUri: GOOGLE_TOKEN_URI,
      endpoint: GCS_DEFAULT_ENDPOINT,
    })
    const store = createGcsBlobStore({
      bucket: 'blobs',
      credentials: { client_email: CLIENT_EMAIL, private_key: privateKey },
      fetch: service.fetch,
      now: clock.now,
    })

    expect(await store.stat(hashBytes(Buffer.from('x')))).toBeNull()
    expect(service.requests[0]).toBe(`POST ${GOOGLE_TOKEN_URI}`)
  })

  it.each([
    ['get', (store: ReturnType<typeof build>['store']) => store.get(hashBytes(Buffer.from('x')))],
    ['stat', (store: ReturnType<typeof build>['store']) => store.stat(hashBytes(Buffer.from('x')))],
    ['delete', (store: ReturnType<typeof build>['store']) => store.delete(hashBytes(Buffer.from('x')))],
    ['put', (store: ReturnType<typeof build>['store']) => store.put(Buffer.from('x'))],
  ])('reports a refusal to %s as an error', async (_name, operation) => {
    const { common } = build({ retries: 0 })
    const refusing = createGcsBlobStore({
      ...common,
      fetch: async () => new Response('{}', { status: 403 }),
      credentials: undefined,
    })

    await expect(operation(refusing)).rejects.toBeInstanceOf(BlobStoreError)
  })

  it('reports a failed listing and a failed renewal as errors', async () => {
    const { common } = build({ retries: 0 })
    const bytes = Buffer.from('renew me')
    const refusing = createGcsObjectClient({
      ...common,
      credentials: undefined,
      fetch: async () => new Response('{}', { status: 403 }),
    })

    await expect(refusing.list('p')[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(BlobStoreError)
    await expect(refusing.renew(hashBytes(bytes))).rejects.toBeInstanceOf(BlobStoreError)
  })

  it('uses the global fetch and clock when none are given', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }))
    const store = createGcsBlobStore({ bucket: 'blobs' })

    expect(await store.stat(hashBytes(Buffer.from('x')))).toBeNull()
    expect(globalFetch.mock.calls[0][0]).toContain(GCS_DEFAULT_ENDPOINT)
    globalFetch.mockRestore()
  })
})

describe('parseGcsCredentials', () => {
  it('reads the fields sign-in needs from a key file', () => {
    expect(
      parseGcsCredentials(JSON.stringify({ type: 'service_account', client_email: 'a@b', private_key: 'k', extra: 1 })),
    ).toEqual({ client_email: 'a@b', private_key: 'k', token_uri: undefined })
  })

  it.each([
    ['text that is not JSON', 'not json', /not valid JSON/],
    ['JSON that is null', 'null', /need "client_email" and "private_key"/],
    [
      'a key file without a private key',
      JSON.stringify({ client_email: 'a@b' }),
      /need "client_email" and "private_key"/,
    ],
    ['a key file without an email', JSON.stringify({ private_key: 'k' }), /need "client_email" and "private_key"/],
  ])('refuses %s', (_label, text, message) => {
    expect(() => parseGcsCredentials(text)).toThrow(ImageStoreConfigurationError)
    expect(() => parseGcsCredentials(text)).toThrow(message)
  })

  it('never puts the private key in an error message', () => {
    expect(() => parseGcsCredentials(JSON.stringify({ private_key: 'SECRET-KEY-TEXT' }))).not.toThrow(/SECRET-KEY-TEXT/)
  })
})

describe('buildTokenRequestBody', () => {
  it('builds a JWT bearer grant whose claims name the account, scope, audience and a one-hour life', () => {
    const body = new URLSearchParams(buildTokenRequestBody(ACCOUNT, 1_700_000_000_500))
    const [header, claims] = (body.get('assertion') as string).split('.')

    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/devstorage.read_write',
      aud: TOKEN_URI,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    })
  })
})
