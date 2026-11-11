import { createPublicKey, createVerify, type KeyObject } from 'node:crypto'
import type { FetchFunction } from '../http'
import type { FakeClock } from './fake-clock'

/** A Cloud Storage service and its token endpoint in memory, reached through an injected `fetch`. */
export type FakeGcs = {
  fetch: FetchFunction
  objects: Map<string, { bytes: Buffer; updatedMs: number }>
  /** Every address requested, as `METHOD url`, in order. */
  requests: string[]
  /** How many tokens the fake has issued. */
  tokensIssued: () => number
  /** Makes the next token request answer with this status. */
  failNextTokenRequest: (status: number) => void
  /** Makes the next token request answer without an access token. */
  answerNextTokenRequestEmpty: () => void
  /** Lifetime, in seconds, reported with each token. */
  setTokenLifetime: (seconds: number | undefined) => void
}

/** Settings for {@link createFakeGcs}. */
export type FakeGcsOptions = {
  clock: FakeClock
  bucket: string
  /** The service account's public key, so the fake can check the sign-in signature. */
  publicKey: KeyObject | string
  clientEmail: string
  tokenUri: string
  /** Address of the JSON API, for example `https://gcs.example.test`. */
  endpoint: string
  /** When false, requests need no token (an emulator). Defaults to true. */
  requireToken?: boolean
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Builds a fake Cloud Storage service. It checks the sign-in as Google does: the token request
 * must carry a JWT whose signature verifies against the service account's public key and whose
 * claims name the account, the scope and the token endpoint; storage requests must carry the
 * bearer token the fake issued.
 *
 * @param options See {@link FakeGcsOptions}.
 */
export function createFakeGcs(options: FakeGcsOptions): FakeGcs {
  const { clock, bucket, clientEmail, tokenUri, endpoint, requireToken = true } = options
  const publicKey = typeof options.publicKey === 'string' ? createPublicKey(options.publicKey) : options.publicKey
  const objects = new Map<string, { bytes: Buffer; updatedMs: number }>()
  const requests: string[] = []
  let issued = 0
  let failTokenWith: number | null = null
  let emptyToken = false
  let lifetime: number | undefined = 3600

  const issueToken = async (init: RequestInit): Promise<Response> => {
    if (failTokenWith !== null) {
      const status = failTokenWith
      failTokenWith = null
      return json({ error: 'denied' }, status)
    }
    if (emptyToken) {
      emptyToken = false
      return json({})
    }
    const form = new URLSearchParams(init.body as string)
    const [header, claims, signature] = (form.get('assertion') ?? '').split('.')
    const verified = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url')
    const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString())
    const claimsAreRight =
      decoded.iss === clientEmail &&
      decoded.aud === tokenUri &&
      decoded.scope.endsWith('devstorage.read_write') &&
      decoded.iat === Math.floor(clock.now() / 1000) &&
      decoded.exp > decoded.iat
    const grantIsRight = form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer'
    if (!verified || !claimsAreRight || !grantIsRight) return json({ error: 'invalid_grant' }, 400)
    issued += 1
    return json({ access_token: `token-${issued}`, expires_in: lifetime })
  }

  const metadata = (key: string) => {
    const object = objects.get(key) as { bytes: Buffer; updatedMs: number }
    return { name: key, size: String(object.bytes.length), updated: new Date(object.updatedMs).toISOString() }
  }

  const listing = (url: URL): Response => {
    const prefix = url.searchParams.get('prefix') ?? ''
    const limit = Number(url.searchParams.get('maxResults'))
    const after = url.searchParams.get('pageToken') ?? ''
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix) && key > after).sort()
    const page = keys.slice(0, limit)
    const nextPageToken = keys.length > page.length ? page[page.length - 1] : undefined
    return json({ items: page.length ? page.map(metadata) : undefined, nextPageToken })
  }

  const fakeFetch: FetchFunction = async (input, init = {}) => {
    const url = new URL(input)
    const method = (init.method ?? 'GET').toUpperCase()
    requests.push(`${method} ${url.href}`)
    if (url.href === tokenUri) return issueToken(init)

    const headers = new Headers(init.headers)
    if (requireToken && headers.get('authorization') !== `Bearer token-${issued}`)
      return json({ error: 'unauthorized' }, 401)
    if (!url.href.startsWith(endpoint)) return json({ error: 'wrong host' }, 404)

    const bucketPath = `/storage/v1/b/${bucket}/o`
    if (method === 'POST' && url.pathname === `/upload${bucketPath}`) {
      const key = url.searchParams.get('name') as string
      objects.set(key, { bytes: Buffer.from(init.body as Uint8Array), updatedMs: clock.now() })
      return json(metadata(key))
    }
    if (method === 'GET' && url.pathname === bucketPath) return listing(url)
    if (!url.pathname.startsWith(`${bucketPath}/`)) return json({ error: 'not found' }, 404)

    const key = decodeURIComponent(url.pathname.slice(bucketPath.length + 1))
    if (!objects.has(key)) return json({ error: 'not found' }, 404)
    if (method === 'DELETE') {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH') {
      ;(objects.get(key) as { updatedMs: number }).updatedMs = clock.now()
      return json(metadata(key))
    }
    if (url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(objects.get(key)?.bytes ?? []))
    return json(metadata(key))
  }

  return {
    fetch: fakeFetch,
    objects,
    requests,
    tokensIssued: () => issued,
    failNextTokenRequest: (status) => {
      failTokenWith = status
    },
    answerNextTokenRequestEmpty: () => {
      emptyToken = true
    },
    setTokenLifetime: (seconds) => {
      lifetime = seconds
    },
  }
}
