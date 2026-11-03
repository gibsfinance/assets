import { describe, it, expect } from 'vitest'
import {
  CACHE_NAME,
  extractAssetPaths,
  isStorableShell,
  planRequest,
  selectMissingPaths,
  selectOldCacheNames,
  selectStalePaths,
} from './worker-logic'

const origin = 'https://gib.show'
const plan = (url: string, overrides: { method?: string; mode?: string } = {}) =>
  planRequest({ method: 'GET', mode: 'cors', url, ...overrides }, origin)

describe('planRequest', () => {
  it.each(['https://gib.show/', 'https://gib.show/index.html', 'https://gib.show/?utm=1'])(
    'serves the shell for a navigation to %s',
    (url) => expect(plan(url, { mode: 'navigate' })).toBe('shell'),
  )

  it('does not treat a non-navigation fetch of the root as the shell', () => {
    expect(plan('https://gib.show/')).toBe('ignore')
  })

  it.each(['https://gib.show/docs', 'https://gib.show/list/search', 'https://gib.show/openapi.json'])(
    'passes a navigation to %s through',
    (url) => expect(plan(url, { mode: 'navigate' })).toBe('ignore'),
  )

  it('caches hashed files first', () => {
    expect(plan('https://gib.show/assets/index-ab12.js', { mode: 'no-cors' })).toBe('asset')
  })

  it.each(['/image/eip155-1/0xabc', '/networks', '/stats', '/list/default', '/sprite/x', '/token/1'])(
    'passes the API path %s through',
    (path) => expect(plan(`https://gib.show${path}`)).toBe('ignore'),
  )

  it('passes other origins through, even for an assets path or a navigation', () => {
    expect(plan('https://cdn.example.com/assets/index-ab12.js')).toBe('ignore')
    expect(plan('https://evil.test/', { mode: 'navigate' })).toBe('ignore')
  })

  it.each(['POST', 'PUT', 'DELETE', 'HEAD'])('passes %s through', (method) => {
    expect(plan('https://gib.show/assets/index-ab12.js', { method })).toBe('ignore')
    expect(plan('https://gib.show/', { method, mode: 'navigate' })).toBe('ignore')
  })
})

describe('extractAssetPaths', () => {
  const html = `<link rel="modulepreload" href="./assets/a-1.js"><script type="module" src="/assets/index-2.js"></script>
    <style>@font-face{src:url(./assets/inter-3.woff2)}</style><link rel="modulepreload" href="./assets/a-1.js">
    <img src="/image/x?w=1"><link rel="icon" href="favicon.png">`

  it('lists every built file once, as root-relative paths', () => {
    expect(extractAssetPaths(html)).toEqual(['/assets/a-1.js', '/assets/index-2.js', '/assets/inter-3.woff2'])
  })

  it('returns nothing for a page that names no built files', () => {
    expect(extractAssetPaths('<html></html>')).toEqual([])
  })
})

describe('cache selection', () => {
  it('prunes only assets the page no longer names', () => {
    const cached = ['/index.html', '/assets/old-1.js', '/assets/keep-2.js']
    expect(selectStalePaths(cached, ['/assets/keep-2.js', '/assets/new-3.js'])).toEqual(['/assets/old-1.js'])
  })

  it('finds the referenced files the cache lacks', () => {
    expect(selectMissingPaths(['/assets/a.js'], ['/assets/a.js', '/assets/b.js'])).toEqual(['/assets/b.js'])
  })

  it('keeps this version and removes every other cache name', () => {
    expect(selectOldCacheNames([CACHE_NAME, 'gib-shell-v0', 'other'])).toEqual(['gib-shell-v0', 'other'])
  })
})

describe('isStorableShell', () => {
  it.each([
    [{ ok: true, redirected: false }, true],
    [{ ok: false, redirected: false }, false],
    [{ ok: true, redirected: true }, false],
  ])('judges %j as %s', (response, expected) => expect(isStorableShell(response)).toBe(expected))
})
