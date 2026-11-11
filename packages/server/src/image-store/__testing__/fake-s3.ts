import { hashBytes } from '../hash'
import type { FetchFunction } from '../http'
import type { FakeClock } from './fake-clock'

/** One request the fake service received. */
export type RecordedRequest = {
  method: string
  url: URL
  headers: Headers
}

/** How the fake answers a copy-onto-itself request. */
export type CopyBehavior = 'works' | 'unsupported' | 'fails-inside-a-200'

/** An S3 service in memory, reached through an injected `fetch`. */
export type FakeS3 = {
  fetch: FetchFunction
  /** Stored objects by key. */
  objects: Map<string, { bytes: Buffer; modifiedAtMs: number }>
  /** Every request, in order. */
  requests: RecordedRequest[]
  /** Makes the next requests answer with a status, before they are looked at. */
  failNext: (status: number, count?: number) => void
  /** Changes how a copy-onto-itself request is answered. */
  setCopyBehavior: (behavior: CopyBehavior) => void
  /** Makes a listing answer `IsTruncated` without a token. */
  breakPaging: () => void
}

/** Settings for {@link createFakeS3}. */
export type FakeS3Options = {
  clock: FakeClock
  bucket: string
  /** Host of the service, for example `s3.example.test`. */
  host?: string
  /** True when the bucket is in the host name rather than the path. */
  virtualHosted?: boolean
}

const xmlEscape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Builds a fake S3 service that checks what a real one checks about a signed request: that the
 * request names the right bucket, carries a signature, and that its `x-amz-content-sha256` and
 * `x-amz-date` match the body and the clock. The signature itself is checked in the signer's own
 * tests and by the MinIO emulator tests.
 *
 * @param options See {@link FakeS3Options}.
 */
export function createFakeS3(options: FakeS3Options): FakeS3 {
  const { clock, bucket, host = 's3.example.test', virtualHosted = false } = options
  const objects = new Map<string, { bytes: Buffer; modifiedAtMs: number }>()
  const requests: RecordedRequest[] = []
  let failures: { status: number; count: number } | null = null
  let copyBehavior: CopyBehavior = 'works'
  let pagingBroken = false

  const answer = (status: number, body: BodyInit | null = null, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers })

  const listing = (url: URL): Response => {
    const prefix = url.searchParams.get('prefix') ?? ''
    const limit = Number(url.searchParams.get('max-keys'))
    const after = url.searchParams.get('continuation-token') ?? ''
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && key > after).sort()
    const page = keys.slice(0, limit)
    const isTruncated = keys.length > page.length
    const contents = page
      .map((key) => {
        const object = objects.get(key) as { bytes: Buffer; modifiedAtMs: number }
        const modified = new Date(object.modifiedAtMs).toISOString()
        return `<Contents><Key>${xmlEscape(key)}</Key><LastModified>${modified}</LastModified><Size>${object.bytes.length}</Size></Contents>`
      })
      .join('')
    const token =
      isTruncated && !pagingBroken ? `<NextContinuationToken>${page[page.length - 1]}</NextContinuationToken>` : ''
    return answer(
      200,
      `<?xml version="1.0"?><ListBucketResult><IsTruncated>${isTruncated}</IsTruncated>${token}${contents}</ListBucketResult>`,
    )
  }

  const copyOntoItself = (key: string, headers: Headers): Response => {
    const object = objects.get(key)
    if (copyBehavior === 'unsupported') return answer(501, '<Error><Code>NotImplemented</Code></Error>')
    if (copyBehavior === 'fails-inside-a-200') return answer(200, '<Error><Code>InternalError</Code></Error>')
    if (!object) return answer(404, '<Error><Code>NoSuchKey</Code></Error>')
    if (headers.get('x-amz-metadata-directive') !== 'REPLACE')
      return answer(400, '<Error><Code>InvalidRequest</Code></Error>')
    object.modifiedAtMs = clock.now()
    return answer(200, '<CopyObjectResult><ETag>"x"</ETag></CopyObjectResult>')
  }

  const fakeFetch: FetchFunction = async (input, init = {}) => {
    const url = new URL(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    requests.push({ method, url, headers })

    if (failures && failures.count > 0) {
      failures.count -= 1
      return answer(failures.status, '<Error><Code>SlowDown</Code></Error>')
    }

    const body = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0)
    const expectedHost = virtualHosted ? `${bucket}.${host}` : host
    if (url.host !== expectedHost) return answer(404, '<Error><Code>NoSuchBucket</Code></Error>')
    const path = decodeURIComponent(url.pathname)
    const bucketPrefix = virtualHosted ? '/' : `/${bucket}/`
    if (!path.startsWith(bucketPrefix)) return answer(404, '<Error><Code>NoSuchBucket</Code></Error>')
    const key = path.slice(bucketPrefix.length)

    const authorization = headers.get('authorization') ?? ''
    const signedWithTheRightScope = authorization.startsWith('AWS4-HMAC-SHA256 Credential=')
    if (!signedWithTheRightScope) return answer(403, '<Error><Code>AccessDenied</Code></Error>')
    if (headers.get('x-amz-content-sha256') !== hashBytes(body))
      return answer(400, '<Error><Code>XAmzContentSHA256Mismatch</Code></Error>')
    const stamp = new Date(clock.now()).toISOString().replace(/[:-]|\.\d{3}/g, '')
    if (headers.get('x-amz-date') !== stamp) return answer(403, '<Error><Code>RequestTimeTooSkewed</Code></Error>')

    if (method === 'GET' && url.searchParams.get('list-type') === '2') return listing(url)
    const object = objects.get(key)
    if (method === 'PUT' && headers.has('x-amz-copy-source')) return copyOntoItself(key, headers)
    if (method === 'PUT') {
      objects.set(key, { bytes: body, modifiedAtMs: clock.now() })
      return answer(200)
    }
    if (method === 'DELETE') {
      objects.delete(key)
      return answer(204)
    }
    if (!object) return answer(404, '<Error><Code>NoSuchKey</Code></Error>')
    if (method === 'HEAD') {
      return answer(200, null, {
        'content-length': String(object.bytes.length),
        'last-modified': new Date(object.modifiedAtMs).toUTCString(),
      })
    }
    return answer(200, new Uint8Array(object.bytes))
  }

  return {
    fetch: fakeFetch,
    objects,
    requests,
    failNext: (status, count = 1) => {
      failures = { status, count }
    },
    setCopyBehavior: (behavior) => {
      copyBehavior = behavior
    },
    breakPaging: () => {
      pagingBroken = true
    },
  }
}
