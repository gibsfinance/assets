/**
 * Attribution headers, driven through a REAL Express response.
 *
 * Why this file exists, separately from `attribution.test.ts`: those tests call
 * `attributionHeaders()` and inspect the record it returns, and the handler tests
 * apply that record to a `mockResponse()` whose `set` is a `vi.fn()`. Neither
 * validates anything. A `vi.fn()` accepts a header value that a real
 * `ServerResponse` refuses.
 *
 * That gap shipped a defect: the four attribution constants contained an em dash
 * (U+2014). Node's header validator rejects every code point above U+00FF by
 * throwing `ERR_INVALID_CHAR`, so every image response with a recognised provider
 * returned a 500 while the whole unit suite stayed green. These tests put a real
 * response on the other end so that class of defect fails here first.
 */
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { attributionHeaders, ATTRIBUTION_HEADER_NAMES, resolveAttribution } from './attribution'

/** Serve one request whose headers come from `attributionHeaders`, as the handlers do. */
const appFor = (input: { uri?: string | null; providerKey?: string | null }) => {
  const app = express()
  app.get('/', (_req, res) => {
    const headers = attributionHeaders(input)
    for (const [name, value] of Object.entries(headers)) {
      res.set(name, value)
    }
    res.status(200).send('ok')
  })
  return app
}

/** Every source the registry can resolve, reached the way production reaches it. */
const REGISTERED_PROVIDERS = ['trustwallet', 'smoldapp', 'ethereum-lists', 'pls369'] as const

describe('attribution headers on a real response', () => {
  it.each(REGISTERED_PROVIDERS)('serves 200 and publishes the attribution for provider %s', async (providerKey) => {
    const res = await request(appFor({ providerKey, uri: 'https://example.test/logo.png' })).get('/')

    // The assertion that would have caught the em dash: a real ServerResponse
    // throws rather than dropping the header, so an unsendable value is a 500.
    expect(res.status).toBe(200)

    // And the header must actually arrive, not merely fail to crash — a guard
    // that silently dropped every attribution would also return 200.
    const expected = resolveAttribution({ providerKey, uri: null }).attribution
    expect(expected, `${providerKey} has no attribution to publish`).toBeTruthy()
    expect(res.headers['x-attribution']).toBe(expected)
  })

  it('publishes a licence link and a licence on every response', async () => {
    const res = await request(appFor({})).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['link']).toBe('<https://gib.show/terms>; rel="license"')
    expect(res.headers['x-license']).toBe('unknown')
  })

  it('sends a Latin-1 uri exactly as stored, without encoding it', async () => {
    // Node accepts the high half of Latin-1, so an accented uri needs no help and
    // must not be silently rewritten. This pins the "encode only when the raw
    // value cannot be sent" rule from the other direction — a guard that encoded
    // everything would pass the test below while corrupting ordinary uris.
    const stored = 'https://exämple.test/lögo.png'
    const res = await request(appFor({ uri: stored })).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['x-source-uri']).toBe(stored)
  })

  it('survives a stored uri carrying a character no header can hold', async () => {
    // An internationalised domain outside Latin-1 reaches the database like any
    // other uri. Its raw form cannot be sent, but percent-encoding is its
    // lossless header form, so the attribution survives rather than vanishing.
    const stored = 'https://例え.test/ロゴ.png'
    const res = await request(appFor({ uri: stored })).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['x-source-uri']).toBe(encodeURI(stored))
    expect(res.headers['x-uri']).toBe(res.headers['x-source-uri'])
  })

  it('refuses to put a carriage return or line feed into a header', async () => {
    // Node rejects these today, so the direct risk is a 500 rather than a split
    // response. The guard keeps it a served image either way, and means the
    // service does not depend on Node continuing to refuse.
    const res = await request(appFor({ uri: 'https://example.test/a\r\nx-injected: yes' })).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['x-injected']).toBeUndefined()
  })

  it('does not describe its own filesystem when an image is stored outside the submodules', async () => {
    const res = await request(appFor({ uri: '/var/lib/gibs/private/logo.png' })).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['x-source-uri']).toBeUndefined()
    expect(res.headers['x-uri']).toBeUndefined()
  })

  it('sends nothing outside the documented header set', async () => {
    // The cors() configuration exposes exactly ATTRIBUTION_HEADER_NAMES, so a
    // header emitted here but missing from that list would be invisible to every
    // browser client — a silent half-failure rather than a loud one.
    const res = await request(appFor({ providerKey: 'trustwallet', uri: 'https://example.test/logo.png' })).get('/')
    const emitted = Object.keys(
      attributionHeaders({ providerKey: 'trustwallet', uri: 'https://example.test/logo.png' }),
    )
    for (const name of emitted) {
      expect(ATTRIBUTION_HEADER_NAMES as readonly string[]).toContain(name)
      expect(res.headers[name]).toBeDefined()
    }
  })
})
