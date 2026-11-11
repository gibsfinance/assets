import { signSharedKey } from '../azure'
import type { FetchFunction } from '../http'
import type { FakeClock } from './fake-clock'

/** A Blob service in memory, reached through an injected `fetch`. */
export type FakeAzure = {
  fetch: FetchFunction
  objects: Map<string, { bytes: Buffer; modifiedAtMs: number }>
  /** Every request, as `METHOD url`, in order. */
  requests: string[]
  /** Makes the next requests answer with a status, before they are looked at. */
  failNext: (status: number, count?: number) => void
}

/** Settings for {@link createFakeAzure}. */
export type FakeAzureOptions = {
  clock: FakeClock
  accountName: string
  containerName: string
  /** Host of the service. Defaults to `<account>.blob.example.test`. */
  host?: string
  /** Requires Shared Key signatures made with this key. */
  accountKey?: string
  /** Requires these query parameters, as a SAS token has. */
  sasToken?: string
}

const xmlEscape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Builds a fake Blob service. It checks what the real one checks of a request: the version and
 * date headers, the blob type on a write, and either a Shared Key signature recomputed from the
 * request as it arrived or the SAS parameters. The signing algorithm itself is pinned in the
 * adapter's own tests and checked for real by the Azurite emulator tests.
 *
 * @param options See {@link FakeAzureOptions}.
 */
export function createFakeAzure(options: FakeAzureOptions): FakeAzure {
  const { clock, accountName, containerName, accountKey, sasToken } = options
  const host = options.host ?? `${accountName}.blob.example.test`
  const objects = new Map<string, { bytes: Buffer; modifiedAtMs: number }>()
  const requests: string[] = []
  let failures: { status: number; count: number } | null = null

  const answer = (status: number, body: BodyInit | null = null, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers })

  const refusal = (url: URL, method: string, headers: Headers, body: Uint8Array | undefined): Response | null => {
    if (headers.get('x-ms-version') !== '2021-08-06')
      return answer(400, '<Error><Code>InvalidHeaderValue</Code></Error>')
    if (headers.get('x-ms-date') !== new Date(clock.now()).toUTCString())
      return answer(403, '<Error><Code>AuthenticationFailed</Code></Error>')
    if (accountKey) {
      const expected = signSharedKey(
        { method, url, headers: Object.fromEntries(headers), contentLength: body?.byteLength ?? 0, accountName },
        accountKey,
      )
      if (headers.get('authorization') !== expected)
        return answer(403, '<Error><Code>AuthenticationFailed</Code></Error>')
    }
    for (const [name, value] of new URLSearchParams((sasToken ?? '').replace(/^\?/, ''))) {
      if (url.searchParams.get(name) !== value) return answer(403, '<Error><Code>AuthenticationFailed</Code></Error>')
    }
    return null
  }

  const listing = (url: URL): Response => {
    const prefix = url.searchParams.get('prefix') ?? ''
    const limit = Number(url.searchParams.get('maxresults'))
    const after = url.searchParams.get('marker') ?? ''
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && key > after).sort()
    const page = keys.slice(0, limit)
    const next = keys.length > page.length ? `<NextMarker>${page[page.length - 1]}</NextMarker>` : '<NextMarker />'
    const blobs = page
      .map((key) => {
        const object = objects.get(key) as { bytes: Buffer; modifiedAtMs: number }
        return `<Blob><Name>${xmlEscape(key)}</Name><Properties><Last-Modified>${new Date(object.modifiedAtMs).toUTCString()}</Last-Modified><Content-Length>${object.bytes.length}</Content-Length></Properties></Blob>`
      })
      .join('')
    return answer(200, `<?xml version="1.0"?><EnumerationResults><Blobs>${blobs}</Blobs>${next}</EnumerationResults>`)
  }

  const fakeFetch: FetchFunction = async (input, init = {}) => {
    const url = new URL(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    const body = init.body ? new Uint8Array(init.body as Uint8Array) : undefined
    requests.push(`${method} ${url.href}`)

    if (failures && failures.count > 0) {
      failures.count -= 1
      return answer(failures.status, '<Error><Code>ServerBusy</Code></Error>')
    }
    if (url.host !== host) return answer(404, '<Error><Code>ResourceNotFound</Code></Error>')
    const denied = refusal(url, method, headers, body)
    if (denied) return denied

    const containerPath = `/${containerName}`
    if (method === 'GET' && url.pathname === containerPath) return listing(url)
    const key = decodeURIComponent(url.pathname.slice(containerPath.length + 1))
    const object = objects.get(key)

    if (method === 'PUT' && url.searchParams.get('comp') === 'metadata') {
      if (!object) return answer(404, '<Error><Code>BlobNotFound</Code></Error>')
      object.modifiedAtMs = clock.now()
      return answer(200)
    }
    if (method === 'PUT') {
      if (headers.get('x-ms-blob-type') !== 'BlockBlob')
        return answer(400, '<Error><Code>MissingRequiredHeader</Code></Error>')
      objects.set(key, { bytes: Buffer.from(body ?? []), modifiedAtMs: clock.now() })
      return answer(201)
    }
    if (!object) return answer(404, '<Error><Code>BlobNotFound</Code></Error>')
    if (method === 'DELETE') {
      objects.delete(key)
      return answer(202)
    }
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
  }
}
