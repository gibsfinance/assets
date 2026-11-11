/**
 * @module image-store/sigv4
 * AWS Signature Version 4 for requests to an S3-compatible service.
 *
 * This is the whole of what the S3 adapter needs from the AWS software development kit, in
 * about eighty lines on `node:crypto`: the kit's S3 client brings roughly twenty megabytes of
 * packages for the same five requests, and every S3-compatible provider documents Signature
 * Version 4 as the way in. The algorithm is checked in `sigv4.test.ts` against the signatures
 * AWS publishes in its S3 documentation.
 */
import { createHash, createHmac, type BinaryLike } from 'node:crypto'
import { encodeRfc3986 } from './encoding'

/** The keys that sign requests. */
export type AwsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  /** Present for temporary credentials. It is signed and sent as `x-amz-security-token`. */
  sessionToken?: string
}

/** What {@link signRequestV4} needs to know about a request. */
export type SignRequestOptions = {
  method: string
  /** The full address, with its query. The path must already be percent-encoded. */
  url: URL
  /** Headers the caller will send, besides `host`, which is taken from the address. */
  headers?: Record<string, string>
  /** sha256 of the body in lowercase hexadecimal. The hash of nothing for a request without a body. */
  payloadSha256: string
  /** The region name the service signs for, for example `us-east-1`, or `auto` for Cloudflare R2. */
  region: string
  /** The credential scope's service name. S3 and its compatible services use `s3`. */
  service?: string
  credentials: AwsCredentials
  /** The moment the request is signed. */
  date: Date
}

/** sha256 of an empty body, as hexadecimal. */
export const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const hmac = (key: BinaryLike, data: string): Buffer => createHmac('sha256', key).update(data).digest()

const sha256Hex = (data: string): string => createHash('sha256').update(data).digest('hex')

/** Orders two encoded (so plain ASCII) texts by byte value, which is what the signature specifies. */
const compareBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b))

/** The query as Signature Version 4 canonicalises it: encoded, then sorted by name and value. */
const canonicalQuery = (url: URL): string =>
  [...url.searchParams.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .sort(([nameA, valueA], [nameB, valueB]) => compareBytes(nameA, nameB) || compareBytes(valueA, valueB))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')

/**
 * Signs a request.
 *
 * The returned headers are everything the caller must send: the headers it passed in (names in
 * lower case), `x-amz-date`, `x-amz-content-sha256` (which S3 requires), `x-amz-security-token`
 * for temporary credentials, and `authorization`. `host` is signed but not returned: the HTTP
 * client sets it from the address, and sets the same value.
 *
 * @param options See {@link SignRequestOptions}.
 * @returns The headers to send.
 */
export function signRequestV4(options: SignRequestOptions): Record<string, string> {
  const { method, url, payloadSha256, region, service = 's3', credentials, date } = options
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = timestamp.slice(0, 8)

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.headers ?? {})) headers[name.toLowerCase()] = value
  headers['x-amz-date'] = timestamp
  headers['x-amz-content-sha256'] = payloadSha256
  if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken

  const signedHeaders: Record<string, string> = { ...headers, host: url.host }
  const names = Object.keys(signedHeaders).sort()
  const canonicalHeaders = names.map((name) => `${name}:${signedHeaders[name].trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaderNames = names.join(';')

  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname,
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaderNames,
    payloadSha256,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = [dateStamp, region, service, 'aws4_request'].reduce<Buffer>(
    (key, part) => hmac(key, part),
    Buffer.from(`AWS4${credentials.secretAccessKey}`),
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaderNames}, Signature=${signature}`
  return headers
}
