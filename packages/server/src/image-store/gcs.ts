/**
 * @module image-store/gcs
 * Blob storage on Google Cloud Storage, through its JSON API with service-account sign-in.
 *
 * This is the native API, not the S3 interoperability layer. Interoperability is close, but it
 * needs a separate pair of HMAC keys that an operator must create and rotate beside the
 * service account, and it is a second authentication path to document and secure. The native
 * API needs one thing that already exists: the service account's JSON key. Signing in is one
 * RS256 signature (`node:crypto`) and one token request, cached until a minute before it
 * expires, so the whole adapter adds no package.
 *
 * Refreshing a modification time is a metadata PATCH: it moves the object's `updated` time and
 * sends no bytes.
 */
import { createSign } from 'node:crypto'
import { ImageStoreConfigurationError } from './configuration-error'
import {
  BlobStoreError,
  DEFAULT_PAGE_SIZE,
  expectStatus,
  parseModifiedAt,
  readBytes,
  sendWithRetry,
  type FetchFunction,
  type RemoteStoreEnvironment,
} from './http'
import { createObjectBlobStore, type ObjectClient, type ObjectInfo } from './object-blob-store'
import type { BlobStore } from './types'

/** The fields of a service-account key file that sign-in uses. */
export type GcsServiceAccount = {
  client_email: string
  private_key: string
  /** Where tokens are requested. Defaults to Google's endpoint. */
  token_uri?: string
}

/** Default token endpoint, from the service-account key file's usual `token_uri`. */
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'

/** Default address of the JSON API. */
export const GCS_DEFAULT_ENDPOINT = 'https://storage.googleapis.com'

const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const TOKEN_LIFETIME_SECONDS = 3600
const TOKEN_REFRESH_MARGIN_MS = 60_000

/**
 * Reads a service-account key file's text.
 *
 * @param json The contents of the key file, which Google's console downloads as JSON.
 * @returns The fields sign-in needs.
 * @throws ImageStoreConfigurationError when the text is not JSON or lacks `client_email` or `private_key`.
 */
export function parseGcsCredentials(json: string): GcsServiceAccount {
  let parsed: Partial<GcsServiceAccount>
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new ImageStoreConfigurationError('the Google Cloud credentials are not valid JSON')
  }
  if (typeof parsed?.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new ImageStoreConfigurationError('the Google Cloud credentials need "client_email" and "private_key"')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri }
}

const base64Url = (value: string | Buffer): string => Buffer.from(value).toString('base64url')

/**
 * Builds the signed token request body for a service account (Google's "JWT bearer" grant).
 *
 * @param account The service account.
 * @param nowMs The current time in milliseconds.
 * @returns The form body to post to the token endpoint.
 */
export function buildTokenRequestBody(account: GcsServiceAccount, nowMs: number): string {
  const issuedAt = Math.floor(nowMs / 1000)
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri ?? GOOGLE_TOKEN_URI,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  }
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify(claims))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')
  return new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`,
  }).toString()
}

/** Settings for {@link createGcsObjectClient}. */
export type GcsClientOptions = RemoteStoreEnvironment & {
  bucket: string
  /** Service-account key. Absent only for an emulator, which does not check sign-in. */
  credentials?: GcsServiceAccount
  /** Address of the JSON API. Defaults to Google's. Set it to aim at an emulator. */
  endpoint?: string
}

/**
 * Builds the six operations of {@link ObjectClient} on the Cloud Storage JSON API.
 *
 * @param options See {@link GcsClientOptions}.
 * @returns The client.
 */
export function createGcsObjectClient(options: GcsClientOptions): ObjectClient {
  const { bucket, credentials, now = Date.now, pageSize = DEFAULT_PAGE_SIZE } = options
  const fetchFunction: FetchFunction = options.fetch ?? fetch
  const endpoint = (options.endpoint ?? GCS_DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const bucketPath = `${endpoint}/storage/v1/b/${encodeURIComponent(bucket)}/o`
  let cachedToken: { value: string; expiresAtMs: number } | undefined
  let pendingToken: Promise<string> | undefined

  const requestToken = async (account: GcsServiceAccount): Promise<string> => {
    const response = await sendWithRetry(
      () =>
        fetchFunction(account.token_uri ?? GOOGLE_TOKEN_URI, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: buildTokenRequestBody(account, now()),
        }),
      options,
    )
    const answer = (await (await expectStatus(response, 'gcs token request')).json()) as {
      access_token?: string
      expires_in?: number
    }
    if (!answer.access_token) throw new BlobStoreError('gcs token request answered without a token')
    const lifetimeMs = (answer.expires_in ?? TOKEN_LIFETIME_SECONDS) * 1000
    cachedToken = { value: answer.access_token, expiresAtMs: now() + lifetimeMs }
    return answer.access_token
  }

  /** A valid access token, or none when running without credentials. Concurrent callers share one request. */
  const accessToken = async (): Promise<string | null> => {
    if (!credentials) return null
    if (cachedToken && now() < cachedToken.expiresAtMs - TOKEN_REFRESH_MARGIN_MS) return cachedToken.value
    pendingToken ??= requestToken(credentials).finally(() => {
      pendingToken = undefined
    })
    return pendingToken
  }

  const request = (
    method: string,
    url: string,
    extra: { headers?: Record<string, string>; body?: BodyInit } = {},
  ): Promise<Response> =>
    sendWithRetry(async () => {
      const token = await accessToken()
      const headers = { ...extra.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }
      return fetchFunction(url, { method, headers, body: extra.body })
    }, options)

  const objectUrl = (key: string): string => `${bucketPath}/${encodeURIComponent(key)}`

  const describe = (item: { name: string; size: string; updated: string }): ObjectInfo => ({
    key: item.name,
    byteSize: Number(item.size),
    modifiedAtMs: parseModifiedAt(item.updated, 'gcs'),
  })

  const put = async (key: string, bytes: Uint8Array): Promise<void> => {
    const url = `${endpoint}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(key)}`
    const response = await request('POST', url, {
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes as BodyInit,
    })
    await expectStatus(response, 'gcs put')
  }

  const get = async (key: string): Promise<Buffer | null> => {
    const response = await request('GET', `${objectUrl(key)}?alt=media`)
    if (response.status === 404) return null
    return readBytes(await expectStatus(response, 'gcs get'))
  }

  const head = async (key: string): Promise<ObjectInfo | null> => {
    const response = await request('GET', objectUrl(key))
    if (response.status === 404) return null
    return describe((await (await expectStatus(response, 'gcs head')).json()) as Parameters<typeof describe>[0])
  }

  const remove = async (key: string): Promise<void> => {
    await expectStatus(await request('DELETE', objectUrl(key)), 'gcs delete', [200, 204, 404])
  }

  const renew = async (key: string): Promise<void> => {
    const response = await request('PATCH', objectUrl(key), {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { renewedAt: new Date(now()).toISOString() } }),
    })
    await expectStatus(response, 'gcs renew')
  }

  async function* list(prefix: string): AsyncGenerator<ObjectInfo, void, undefined> {
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({
        prefix,
        maxResults: String(pageSize),
        fields: 'items(name,size,updated),nextPageToken',
      })
      if (pageToken) query.set('pageToken', pageToken)
      const response = await request('GET', `${bucketPath}?${query}`)
      const page = (await (await expectStatus(response, 'gcs list')).json()) as {
        items?: Parameters<typeof describe>[0][]
        nextPageToken?: string
      }
      for (const item of page.items ?? []) yield describe(item)
      pageToken = page.nextPageToken
    } while (pageToken)
  }

  return { put, get, head, remove, renew, list }
}

/** Settings for {@link createGcsBlobStore}. */
export type GcsBlobStoreOptions = GcsClientOptions & {
  /** Text put before every key. Defaults to none. */
  keyPrefix?: string
}

/**
 * A blob store on a Cloud Storage bucket.
 *
 * @param options See {@link GcsBlobStoreOptions}.
 * @returns The store.
 */
export function createGcsBlobStore(options: GcsBlobStoreOptions): BlobStore {
  return createObjectBlobStore({ client: createGcsObjectClient(options), keyPrefix: options.keyPrefix })
}
