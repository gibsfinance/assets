#!/usr/bin/env node
/**
 * Smoke test a deployed instance: every documented endpoint, plus the inputs
 * that should be refused.
 *
 * Defaults to staging, because a script that hits production when you forget an
 * argument is a script that eventually hits production when you did not mean to.
 *
 *   node scripts/smoke-test.mjs                    # staging
 *   node scripts/smoke-test.mjs https://gib.show   # production
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 *
 * Every request carries a random query parameter, and that is not decoration.
 * Image responses are cached at the edge for a day, so a plain request made
 * after a deploy can be answered from a copy made before it. That reads as
 * missing response headers rather than as a stale body, which is a confusing
 * way to learn your deploy worked.
 */

const fallbackTarget = 'https://staging.gib.show'
const argument = process.argv[2]
const configured = process.env['BASE_URL']
const BASE_URL = (argument || configured || fallbackTarget).replace(/\/$/, '')

/** A token that exists on Ethereum and carries artwork from a known provider. */
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

/**
 * Headers that attributionHeaders promises on every image response. `link` and
 * `x-license` are set unconditionally, so if either is absent the response did
 * not come from that code path at all - suspect the edge cache before the code.
 */
const PROVENANCE = ['link', 'x-license', 'x-source-uri', 'x-provider']

/**
 * What every response that carries image bytes must send. A stored vector image is text a stranger
 * uploaded; with this policy a browser that opens it directly cannot run a script in it. They must
 * stay off everything else, because `sandbox` would break the interface and the documentation site.
 */
const IMAGE_SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  'x-content-type-options': 'nosniff',
}

/**
 * The documentation host for a target, by the naming the deployment uses (`docs.gib.show` and
 * `docs-staging.gib.show`). Null for any other target, such as a local one, where the check is skipped.
 */
function docsBaseUrl(base) {
  const { protocol, hostname } = new URL(base)
  if (hostname === 'gib.show') return `${protocol}//docs.gib.show`
  if (hostname === 'staging.gib.show') return `${protocol}//docs-staging.gib.show`
  return null
}

const results = []

async function probe(label, path, options = {}) {
  const {
    expect = [200],
    type,
    follow = false,
    headers = [],
    bodyIncludes,
    headerEquals = {},
    headerAbsent = [],
    headerLacks = {},
    baseUrl = BASE_URL,
  } = options
  const separator = path.includes('?') ? '&' : '?'
  const url = `${baseUrl}${path}${separator}smoke=${Math.random().toString(36).slice(2)}`
  const started = Date.now()

  let response
  try {
    response = await fetch(url, { redirect: follow ? 'follow' : 'manual' })
  } catch (error) {
    results.push({
      ok: false,
      label,
      status: 'ERR',
      type: '',
      bytes: 0,
      ms: Date.now() - started,
      note: error.message,
    })
    return null
  }

  const body = await response.arrayBuffer()
  const ms = Date.now() - started
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim()

  const notes = []
  let ok = expect.includes(response.status)
  if (!ok) notes.push(`expected ${expect.join(' or ')}`)
  if (ok && type && !contentType.includes(type)) {
    ok = false
    notes.push(`expected ${type}`)
  }
  for (const name of headers) {
    if (response.headers.get(name)) continue
    ok = false
    notes.push(`missing ${name}`)
  }

  if (ok && bodyIncludes && !Buffer.from(body).toString('utf8').includes(bodyIncludes)) {
    ok = false
    notes.push(`body lacks ${bodyIncludes}`)
  }
  for (const [name, wanted] of Object.entries(headerEquals)) {
    const actual = response.headers.get(name)
    if (actual === wanted) continue
    ok = false
    notes.push(`${name} is ${actual}, expected ${wanted}`)
  }

  for (const [name, forbidden] of Object.entries(headerLacks)) {
    const actual = response.headers.get(name) ?? ''
    if (!actual.includes(forbidden)) continue
    ok = false
    notes.push(`${name} is ${actual}, which must not contain ${forbidden}`)
  }

  for (const name of headerAbsent) {
    const actual = response.headers.get(name)
    if (actual === null) continue
    ok = false
    notes.push(`${name} is ${actual}, expected none`)
  }

  results.push({
    ok,
    label,
    status: response.status,
    type: contentType,
    bytes: body.byteLength,
    ms,
    note: notes.join(', '),
  })
  return response
}

console.log(`Smoke testing ${BASE_URL}\n`)

// The service, and what it says about itself.
await probe('health', '/health', { type: 'json' })
await probe('networks', '/networks', { type: 'json' })
await probe('openapi definition', '/openapi.json', { type: 'json' })
await probe('llms.txt', '/llms.txt')
await probe('terms page', '/terms', { type: 'markdown' })
await probe('docs redirect', '/docs', { expect: [302] })
await probe('docs followed', '/docs', { follow: true, type: 'text/html' })
await probe('interface root', '/', { type: 'text/html' })

// Token lists.
await probe('all lists', '/list/', { type: 'json' })
await probe('one provider', '/list/piteas', { type: 'json' })
await probe('one list', '/list/piteas/exchange', { type: 'json' })
await probe('tokens by chain', '/list/tokens/eip155-1', { type: 'json' })
await probe('tokens, non-EVM', '/list/tokens/solana-501', { type: 'json' })
// Algorand ARC-25 chain ids are aliases of the stored network algorand-283.
await probe('tokens, Algorand legacy id', '/list/tokens/4160', {
  type: 'json',
  bodyIncludes: 'algorand-283',
})
await probe('tokens, Algorand MainNet id', '/list/tokens/416001', {
  type: 'json',
  bodyIncludes: 'algorand-283',
})
await probe('merged', '/list/merged/default?chainId=eip155-369', {
  type: 'json',
})
await probe('merged, filtered', '/list/merged/default?chainId=eip155-1&decimals=6', { type: 'json' })
await probe('search', '/list/search?q=usdc', { type: 'json' })

// Images, in every form the address can take.
await probe('network image', '/image/eip155-1', {
  type: 'image/',
  headers: PROVENANCE,
})
await probe('token image', `/image/eip155-1/${USDC}`, {
  type: 'image/',
  headers: PROVENANCE,
})
await probe('extension form', `/image/eip155-1/${USDC}.webp`, {
  type: 'image/webp',
})
await probe('query conversion', `/image/eip155-1/${USDC}?as=webp&width=128`, {
  type: 'image/webp',
})
await probe('resize', `/image/eip155-1/${USDC}?width=32`, { type: 'image/' })
// A plate behind the logo. The Ethereum network icon is a vector, so a plated one stays a vector.
await probe('plated vector', '/image/eip155-1?bg=ffffff&shape=rounded', {
  type: 'image/svg+xml',
  bodyIncludes: 'fill="#ffffff"',
})
await probe('plated pixels', `/image/eip155-1/${USDC}?bg=ffffff&as=png&w=64`, { type: 'image/png' })
await probe('contrast', '/image/eip155-1?contrast=dark', { type: 'image/' })
// An answer that depends on plate parameters is never kept for a year, plated or not.
await probe('plated lifetime', '/image/eip155-1?bg=ffffff', {
  type: 'image/svg+xml',
  headerLacks: { 'cache-control': 'immutable' },
})
await probe('contrast lifetime', '/image/eip155-1?contrast=dark', {
  type: 'image/',
  headerLacks: { 'cache-control': 'immutable' },
})

// Image bytes carry the security headers, and nothing else does. The vector-only network icon is an
// svg, the file type the policy exists for. A plated one is sent by a different code path.
await probe('svg security headers', '/image/eip155-1?only=vector', {
  type: 'image/svg+xml',
  headerEquals: IMAGE_SECURITY_HEADERS,
})
await probe('plated svg security headers', '/image/eip155-1?only=vector&bg=ffffff', {
  type: 'image/svg+xml',
  headerEquals: IMAGE_SECURITY_HEADERS,
})
await probe('pixel image security headers', `/image/eip155-1/${USDC}?as=png&w=64`, {
  type: 'image/png',
  headerEquals: IMAGE_SECURITY_HEADERS,
})
await probe('json lacks image headers', '/networks', {
  type: 'json',
  headerAbsent: Object.keys(IMAGE_SECURITY_HEADERS),
})
await probe('interface lacks image headers', '/', {
  type: 'text/html',
  headerAbsent: Object.keys(IMAGE_SECURITY_HEADERS),
})
const docsUrl = docsBaseUrl(BASE_URL)
if (docsUrl) {
  await probe('docs host lacks image headers', '/', {
    baseUrl: docsUrl,
    type: 'text/html',
    headerAbsent: Object.keys(IMAGE_SECURITY_HEADERS),
  })
}
await probe('vector only', `/image/eip155-1/${USDC}?only=vector`, {
  type: 'image/',
})
await probe('ordered image', `/image/coingecko/eip155-1/${USDC}`, {
  type: 'image/',
})
await probe('fallback route', `/image/fallback/coingecko/eip155-1/${USDC}`, {
  type: 'image/',
})

// Algorand Standard Asset 312769 (Tether USD) under the ARC-25 legacy id.
await probe('token image, Algorand alias', '/image/4160/312769', {
  type: 'image/',
  headers: PROVENANCE,
})
await probe('network image, Algorand alias', '/image/4160', {
  type: 'image/',
  headerEquals: { 'x-resolved-chain': 'algorand-283' },
})

// Refusals. The claim under test is that a bad input fails cleanly, never at 500.
await probe('unknown chain', '/image/eip155-99999999', { expect: [400, 404] })
await probe('unknown token', `/image/eip155-1/0x${'de'.repeat(20)}`, {
  expect: [400, 404],
})
await probe('malformed plate colour', '/image/eip155-1?bg=not-a-colour', { expect: [400] })
await probe('malformed plate contrast', '/image/eip155-1?contrast=sideways', { expect: [400] })
await probe('malformed address', '/image/eip155-1/not-an-address', {
  expect: [400, 404],
})
await probe('malformed chain', '/image/banana/0x0', { expect: [400, 404] })
await probe('unknown provider', '/list/no-such-provider-x', {
  expect: [400, 404],
})
await probe('unknown route', '/no-such-route-xyz', { expect: [404] })
await probe('empty search', '/list/search?q=', { expect: [400] })
await probe('merged without a chain', '/list/merged/default', {
  expect: [400],
})

const pad = (value, width) => String(value).padEnd(width)
const padStart = (value, width) => String(value).padStart(width)

console.log(
  `   ${pad('check', 24)}${pad('code', 6)}${pad('content type', 20)}${padStart('bytes', 10)}${padStart('ms', 7)}  note`,
)
console.log('-'.repeat(80))
for (const r of results) {
  const marker = r.ok ? 'ok ' : 'XX '
  console.log(
    `${marker}${pad(r.label, 24)}${pad(r.status, 6)}${pad(r.type, 20)}${padStart(r.bytes, 10)}${padStart(r.ms, 7)}  ${r.note}`,
  )
}
console.log('-'.repeat(80))

const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)

const slow = results.filter((r) => r.ms > 3000).sort((a, b) => b.ms - a.ms)
if (slow.length) {
  console.log(`slower than 3s: ${slow.map((r) => `${r.label} ${r.ms}ms`).join(', ')}`)
  console.log('  The merged endpoint is genuinely heavy - Ethereum carries over 120,000 tokens.')
  console.log('  Its cost is in the query rather than the transfer, so a small filtered answer')
  console.log('  can be slower than a large unfiltered one whenever the cache is cold.')
}

if (failed.length) {
  console.log(`FAILED: ${failed.map((r) => r.label).join(', ')}`)
  process.exit(1)
}
