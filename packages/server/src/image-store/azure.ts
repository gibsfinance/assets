/**
 * @module image-store/azure
 * Blob storage on Azure Blob Storage, signed with the account's Shared Key or opened with a
 * shared access signature (SAS) token.
 *
 * Blobs are block blobs in one container. Refreshing a modification time is a "Set Blob
 * Metadata" request: it moves `Last-Modified` and sends no bytes.
 *
 * Only a 404 means "no such blob".
 */
import { createHmac } from 'node:crypto'
import { ImageStoreConfigurationError } from './configuration-error'
import { encodeObjectPath, encodeRfc3986 } from './encoding'
import {
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
import { readBlocks, readElement } from './xml'

/** The service version every request names. It fixes the shape of the answers this adapter reads. */
export const AZURE_API_VERSION = '2021-08-06'

const OCTET_STREAM = 'application/octet-stream'

/**
 * The headers Shared Key signs in the order it signs them, ahead of the `x-ms-` headers.
 * `date` is left empty because every request here sends `x-ms-date`, which takes its place.
 */
const SIGNED_STANDARD_HEADERS = [
  'content-encoding',
  'content-language',
  'content-length',
  'content-md5',
  'content-type',
  'date',
  'if-modified-since',
  'if-match',
  'if-none-match',
  'if-unmodified-since',
  'range',
] as const

/** What {@link buildSharedKeyStringToSign} needs to know about a request. */
export type SharedKeyRequest = {
  method: string
  /** The full address, with its query. */
  url: URL
  /** Headers the caller sends, with any name case. Must include `x-ms-date` and `x-ms-version`. */
  headers: Record<string, string>
  /** Length of the body. Signed as an empty text when zero, as the service requires. */
  contentLength: number
  accountName: string
}

/**
 * Builds the text Shared Key signs: the verb, the standard headers, the `x-ms-` headers sorted,
 * and the canonicalized resource (the account, the path, then each query parameter in lower
 * case, sorted, with its values joined by commas).
 *
 * @param request See {@link SharedKeyRequest}.
 * @returns The string to sign, as the Azure documentation specifies it.
 */
export function buildSharedKeyStringToSign(request: SharedKeyRequest): string {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = value
  headers['content-length'] = request.contentLength === 0 ? '' : String(request.contentLength)

  const standard = SIGNED_STANDARD_HEADERS.map((name) => headers[name] ?? '')
  const canonicalHeaders = Object.keys(headers)
    .filter((name) => name.startsWith('x-ms-'))
    .sort()
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join('')

  const queryValues = new Map<string, string[]>()
  for (const [name, value] of request.url.searchParams) {
    queryValues.set(name.toLowerCase(), [...(queryValues.get(name.toLowerCase()) ?? []), value])
  }
  const canonicalQuery = [...queryValues.keys()]
    .sort()
    .map((name) => `\n${name}:${(queryValues.get(name) as string[]).sort().join(',')}`)
    .join('')

  const resource = `/${request.accountName}${request.url.pathname}${canonicalQuery}`
  return [request.method.toUpperCase(), ...standard, `${canonicalHeaders}${resource}`].join('\n')
}

/**
 * Signs a request with an account key.
 *
 * @param request See {@link SharedKeyRequest}.
 * @param accountKey The account key, as base64 text as the portal shows it.
 * @returns The value of the `authorization` header, `SharedKey <account>:<signature>`.
 */
export function signSharedKey(request: SharedKeyRequest, accountKey: string): string {
  const signature = createHmac('sha256', Buffer.from(accountKey, 'base64'))
    .update(buildSharedKeyStringToSign(request))
    .digest('base64')
  return `SharedKey ${request.accountName}:${signature}`
}

/** Settings for {@link createAzureObjectClient}. Give exactly one of `accountKey` and `sasToken`. */
export type AzureClientOptions = RemoteStoreEnvironment & {
  accountName: string
  containerName: string
  /** The account key, base64 as the portal shows it. */
  accountKey?: string
  /** A shared access signature token, with or without its leading `?`. Needs read, write, create, delete and list. */
  sasToken?: string
  /** Address of the blob service. Defaults to `https://<account>.blob.core.windows.net`. An emulator's includes the account. */
  endpoint?: string
}

/**
 * Builds the six operations of {@link ObjectClient} on Blob service requests.
 *
 * @param options See {@link AzureClientOptions}.
 * @returns The client.
 * @throws ImageStoreConfigurationError unless exactly one of `accountKey` and `sasToken` is given.
 */
export function createAzureObjectClient(options: AzureClientOptions): ObjectClient {
  const { accountName, containerName, accountKey, sasToken, now = Date.now, pageSize = DEFAULT_PAGE_SIZE } = options
  if (Boolean(accountKey) === Boolean(sasToken)) {
    throw new ImageStoreConfigurationError('azure needs exactly one of an account key and a SAS token')
  }
  const fetchFunction: FetchFunction = options.fetch ?? fetch
  const endpoint = (options.endpoint ?? `https://${accountName}.blob.core.windows.net`).replace(/\/+$/, '')
  const sasParameters = new URLSearchParams((sasToken ?? '').replace(/^\?/, ''))

  const urlOf = (key: string | null, query: Record<string, string> = {}): URL => {
    const text = Object.entries(query)
      .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
      .join('&')
    const path = key === null ? '' : `/${encodeObjectPath(key)}`
    const url = new URL(`${endpoint}/${encodeRfc3986(containerName)}${path}${text ? `?${text}` : ''}`)
    for (const [name, value] of sasParameters) url.searchParams.append(name, value)
    return url
  }

  const request = (
    method: string,
    url: URL,
    extra: { headers?: Record<string, string>; body?: Uint8Array } = {},
  ): Promise<Response> =>
    sendWithRetry(() => {
      const headers: Record<string, string> = {
        ...extra.headers,
        'x-ms-date': new Date(now()).toUTCString(),
        'x-ms-version': AZURE_API_VERSION,
      }
      if (accountKey) {
        headers.authorization = signSharedKey(
          { method, url, headers, contentLength: extra.body?.byteLength ?? 0, accountName },
          accountKey,
        )
      }
      return fetchFunction(url, { method, headers, body: extra.body as BodyInit | undefined })
    }, options)

  const put = async (key: string, bytes: Uint8Array): Promise<void> => {
    const response = await request('PUT', urlOf(key), {
      headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': OCTET_STREAM },
      body: bytes,
    })
    await expectStatus(response, 'azure put', [201])
  }

  const get = async (key: string): Promise<Buffer | null> => {
    const response = await request('GET', urlOf(key))
    if (response.status === 404) return null
    return readBytes(await expectStatus(response, 'azure get'))
  }

  const head = async (key: string): Promise<ObjectInfo | null> => {
    const response = await request('HEAD', urlOf(key))
    if (response.status === 404) return null
    await expectStatus(response, 'azure head')
    return {
      key,
      byteSize: Number(response.headers.get('content-length')),
      modifiedAtMs: parseModifiedAt(response.headers.get('last-modified'), 'azure head'),
    }
  }

  const remove = async (key: string): Promise<void> => {
    await expectStatus(await request('DELETE', urlOf(key)), 'azure delete', [202, 404])
  }

  const renew = async (key: string): Promise<void> => {
    const response = await request('PUT', urlOf(key, { comp: 'metadata' }), {
      headers: { 'x-ms-meta-renewedat': new Date(now()).toISOString() },
    })
    await expectStatus(response, 'azure renew')
  }

  async function* list(prefix: string): AsyncGenerator<ObjectInfo, void, undefined> {
    let marker: string | undefined
    do {
      const query: Record<string, string> = {
        restype: 'container',
        comp: 'list',
        prefix,
        maxresults: String(pageSize),
      }
      if (marker) query.marker = marker
      const response = await request('GET', urlOf(null, query))
      const page = await (await expectStatus(response, 'azure list')).text()
      for (const entry of readBlocks(page, 'Blob')) {
        yield {
          key: readElement(entry, 'Name') as string,
          byteSize: Number(readElement(entry, 'Content-Length')),
          modifiedAtMs: parseModifiedAt(readElement(entry, 'Last-Modified'), 'azure list'),
        }
      }
      marker = readElement(page, 'NextMarker') || undefined
    } while (marker)
  }

  return { put, get, head, remove, renew, list }
}

/** Settings for {@link createAzureBlobStore}. */
export type AzureBlobStoreOptions = AzureClientOptions & {
  /** Text put before every key. Defaults to none. */
  keyPrefix?: string
}

/**
 * A blob store on an Azure Blob Storage container.
 *
 * @param options See {@link AzureBlobStoreOptions}.
 * @returns The store.
 */
export function createAzureBlobStore(options: AzureBlobStoreOptions): BlobStore {
  return createObjectBlobStore({ client: createAzureObjectClient(options), keyPrefix: options.keyPrefix })
}
