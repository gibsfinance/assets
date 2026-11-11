/**
 * @module image-store/s3
 * Blob storage on any S3-compatible service.
 *
 * One implementation serves every provider, because they all speak the same five requests
 * (PutObject, GetObject, HeadObject, DeleteObject, ListObjectsV2) plus CopyObject onto itself to
 * refresh a modification time. A provider differs only in where its endpoint is, which region
 * name it signs for, and whether the bucket goes in the host name or in the path. Those
 * differences are the {@link S3_PRESETS}; none has code of its own.
 *
 * Only a 404 means "no such blob". Several services answer 403 for a missing key when the
 * credentials lack permission to list the bucket; that is reported as an error, never as a
 * missing blob, so a permission mistake cannot look like an empty store.
 */
import { ImageStoreConfigurationError } from './configuration-error'
import { hashBytes } from './hash'
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
import { encodeObjectPath, encodeRfc3986 } from './encoding'
import { signRequestV4, EMPTY_PAYLOAD_SHA256, type AwsCredentials } from './sigv4'
import type { BlobStore } from './types'
import { readBlocks, readElement } from './xml'

/** Where the bucket's name goes in a request. */
export type S3Addressing = 'path' | 'virtual'

/** The names a provider preset can have. `minio` and `custom` are the same: any endpoint you name. */
export type S3PresetName = 'aws' | 'r2' | 'hetzner' | 'b2' | 'wasabi' | 'spaces' | 'minio' | 'custom'

/** What a provider preset knows. */
type S3Preset = {
  /** Region used when none is given. Absent when the operator must say. */
  defaultRegion?: string
  /** How the bucket is addressed unless the operator says otherwise. */
  addressing: S3Addressing
  /** The provider's endpoint for a region, or null when the operator must give the endpoint. */
  endpoint: ((region: string, accountId: string | undefined) => string) | null
  /** The provider needs an account identifier to build its endpoint. */
  needsAccountId?: boolean
}

/**
 * The providers, as data. Each endpoint pattern is the provider's documented S3 endpoint.
 * Every entry can be overridden with an explicit endpoint, for a private deployment or a
 * region the pattern does not cover.
 */
export const S3_PRESETS: Readonly<Record<S3PresetName, S3Preset>> = {
  aws: {
    defaultRegion: 'us-east-1',
    addressing: 'virtual',
    endpoint: (region) => `https://s3.${region}.amazonaws.com`,
  },
  r2: {
    defaultRegion: 'auto',
    addressing: 'path',
    needsAccountId: true,
    endpoint: (_region, accountId) => `https://${accountId}.r2.cloudflarestorage.com`,
  },
  hetzner: {
    defaultRegion: 'fsn1',
    addressing: 'path',
    endpoint: (region) => `https://${region}.your-objectstorage.com`,
  },
  b2: { addressing: 'path', endpoint: (region) => `https://s3.${region}.backblazeb2.com` },
  wasabi: {
    defaultRegion: 'us-east-1',
    addressing: 'path',
    endpoint: (region) => `https://s3.${region}.wasabisys.com`,
  },
  spaces: {
    defaultRegion: 'nyc3',
    addressing: 'virtual',
    endpoint: (region) => `https://${region}.digitaloceanspaces.com`,
  },
  minio: { defaultRegion: 'us-east-1', addressing: 'path', endpoint: null },
  custom: { defaultRegion: 'us-east-1', addressing: 'path', endpoint: null },
}

/** The preset names, for messages and validation. */
export const S3_PRESET_NAMES = Object.keys(S3_PRESETS) as S3PresetName[]

/** What a request needs to find a bucket. */
export type S3Location = {
  /** Scheme, host and port, with no path and no bucket. */
  endpoint: string
  /** The region name requests are signed for. */
  region: string
  addressing: S3Addressing
}

/** Settings that decide where a bucket is. */
export type S3LocationInput = {
  preset: S3PresetName
  region?: string
  /** Overrides the preset's endpoint. Required for `minio` and `custom`. */
  endpoint?: string
  /** For `r2`: the Cloudflare account identifier in the endpoint. */
  accountId?: string
  /** Overrides the preset's addressing. */
  addressing?: S3Addressing
}

/**
 * Works out where a bucket is, from a preset and the settings that complete it.
 *
 * @param input See {@link S3LocationInput}.
 * @returns The endpoint, region and addressing to use.
 * @throws ImageStoreConfigurationError when a setting the preset needs is missing or malformed.
 */
export function resolveS3Location(input: S3LocationInput): S3Location {
  const preset = S3_PRESETS[input.preset]
  const region = input.region ?? preset.defaultRegion
  if (!region) throw new ImageStoreConfigurationError(`the "${input.preset}" preset needs a region`)
  if (preset.needsAccountId && !input.accountId) {
    throw new ImageStoreConfigurationError(`the "${input.preset}" preset needs an account id`)
  }
  const endpoint = input.endpoint ?? preset.endpoint?.(region, input.accountId)
  if (!endpoint) throw new ImageStoreConfigurationError(`the "${input.preset}" preset needs an endpoint`)
  let origin: URL
  try {
    origin = new URL(endpoint)
  } catch (error) {
    throw new ImageStoreConfigurationError(`the endpoint is not a web address: ${(error as Error).message}`)
  }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
    throw new ImageStoreConfigurationError('the endpoint must start with https:// or http://')
  }
  return { endpoint: origin.origin, region, addressing: input.addressing ?? preset.addressing }
}

/** Settings for {@link createS3ObjectClient}. */
export type S3ClientOptions = RemoteStoreEnvironment & {
  location: S3Location
  bucket: string
  credentials: AwsCredentials
}

const OCTET_STREAM = 'application/octet-stream'

/**
 * Builds the six operations of {@link ObjectClient} on S3 requests.
 *
 * @param options See {@link S3ClientOptions}.
 * @returns The client.
 */
export function createS3ObjectClient(options: S3ClientOptions): ObjectClient {
  const { location, bucket, credentials, now = Date.now, pageSize = DEFAULT_PAGE_SIZE } = options
  const fetchFunction: FetchFunction = options.fetch ?? fetch
  const endpoint = new URL(location.endpoint)
  const bucketRoot =
    location.addressing === 'virtual'
      ? `${endpoint.protocol}//${bucket}.${endpoint.host}/`
      : `${endpoint.origin}/${encodeRfc3986(bucket)}/`

  const urlOf = (key: string, query: Record<string, string> = {}): URL => {
    const text = Object.entries(query)
      .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
      .join('&')
    return new URL(`${bucketRoot}${encodeObjectPath(key)}${text ? `?${text}` : ''}`)
  }

  const request = (
    method: string,
    url: URL,
    extra: { headers?: Record<string, string>; body?: Uint8Array } = {},
  ): Promise<Response> =>
    sendWithRetry(
      () =>
        fetchFunction(url, {
          method,
          headers: signRequestV4({
            method,
            url,
            headers: extra.headers,
            payloadSha256: extra.body ? hashBytes(extra.body) : EMPTY_PAYLOAD_SHA256,
            region: location.region,
            credentials,
            date: new Date(now()),
          }),
          body: extra.body as BodyInit | undefined,
        }),
      options,
    )

  const put = async (key: string, bytes: Uint8Array): Promise<void> => {
    const response = await request('PUT', urlOf(key), { headers: { 'content-type': OCTET_STREAM }, body: bytes })
    await expectStatus(response, 's3 put')
  }

  const get = async (key: string): Promise<Buffer | null> => {
    const response = await request('GET', urlOf(key))
    if (response.status === 404) return null
    return readBytes(await expectStatus(response, 's3 get'))
  }

  const head = async (key: string): Promise<ObjectInfo | null> => {
    const response = await request('HEAD', urlOf(key))
    if (response.status === 404) return null
    await expectStatus(response, 's3 head')
    return {
      key,
      byteSize: Number(response.headers.get('content-length')),
      modifiedAtMs: parseModifiedAt(response.headers.get('last-modified'), 's3 head'),
    }
  }

  const remove = async (key: string): Promise<void> => {
    await expectStatus(await request('DELETE', urlOf(key)), 's3 delete', [200, 204, 404])
  }

  const renew = async (key: string): Promise<void> => {
    const response = await request('PUT', urlOf(key), {
      headers: {
        'x-amz-copy-source': `/${encodeRfc3986(bucket)}/${encodeObjectPath(key)}`,
        'x-amz-metadata-directive': 'REPLACE',
        'x-amz-meta-renewed-at': new Date(now()).toISOString(),
        'content-type': OCTET_STREAM,
      },
    })
    const body = await (await expectStatus(response, 's3 copy')).text()
    // A copy can fail after the service has already sent "200 OK"; the failure is in the body.
    if (body.includes('<Error>')) throw new BlobStoreError(`s3 copy failed: ${readElement(body, 'Code') ?? 'unknown'}`)
  }

  async function* list(prefix: string): AsyncGenerator<ObjectInfo, void, undefined> {
    let continuationToken: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': String(pageSize) }
      if (continuationToken) query['continuation-token'] = continuationToken
      const response = await request('GET', urlOf('', query))
      const page = await (await expectStatus(response, 's3 list')).text()
      for (const entry of readBlocks(page, 'Contents')) {
        yield {
          key: readElement(entry, 'Key') as string,
          byteSize: Number(readElement(entry, 'Size')),
          modifiedAtMs: parseModifiedAt(readElement(entry, 'LastModified'), 's3 list'),
        }
      }
      const isTruncated = readElement(page, 'IsTruncated') === 'true'
      const nextToken = readElement(page, 'NextContinuationToken')
      if (isTruncated && !nextToken) {
        throw new BlobStoreError('s3 list: the answer is cut off but names no continuation token')
      }
      continuationToken = isTruncated ? nextToken : undefined
    } while (continuationToken)
  }

  return { put, get, head, remove, renew, list }
}

/** Settings for {@link createS3BlobStore}. */
export type S3BlobStoreOptions = S3ClientOptions & {
  /** Text put before every key. Defaults to none. */
  keyPrefix?: string
}

/**
 * A blob store on an S3-compatible bucket.
 *
 * @param options See {@link S3BlobStoreOptions}.
 * @returns The store.
 */
export function createS3BlobStore(options: S3BlobStoreOptions): BlobStore {
  return createObjectBlobStore({ client: createS3ObjectClient(options), keyPrefix: options.keyPrefix })
}
