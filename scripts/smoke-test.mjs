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

const results = []

async function probe(label, path, options = {}) {
  const { expect = [200], type, follow = false, headers = [] } = options
  const separator = path.includes('?') ? '&' : '?'
  const url = `${BASE_URL}${path}${separator}smoke=${Math.random().toString(36).slice(2)}`
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
await probe('vector only', `/image/eip155-1/${USDC}?only=vector`, {
  type: 'image/',
})
await probe('ordered image', `/image/coingecko/eip155-1/${USDC}`, {
  type: 'image/',
})
await probe('fallback route', `/image/fallback/coingecko/eip155-1/${USDC}`, {
  type: 'image/',
})

// Refusals. The claim under test is that a bad input fails cleanly, never at 500.
await probe('unknown chain', '/image/eip155-99999999', { expect: [400, 404] })
await probe('unknown token', `/image/eip155-1/0x${'de'.repeat(20)}`, {
  expect: [400, 404],
})
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
