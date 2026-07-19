import { describe, it, expect } from 'vitest'
import { refreshRequest, REFRESH_CACHE_CONTROL } from './cache-refresh'

const ADMIN_TOKEN = 'test-admin-token'
const validHeader = `Bearer ${ADMIN_TOKEN}`

describe('refreshRequest', () => {
  it('treats an absent parameter as no refresh, so normal traffic is untouched', () => {
    // The overwhelming majority of requests carry no refresh parameter at all.
    // If those were ever classified as requested, every ordinary request would
    // either rebuild the caches or be rejected as unauthorized.
    expect(refreshRequest({ refreshParam: undefined, adminToken: ADMIN_TOKEN })).toEqual({
      requested: false,
      authorized: false,
    })
  })

  it('treats an empty value as no refresh', () => {
    // `?refresh=` is what a form or a stripped query string produces. It expresses
    // no intent, so it must not trip the admin gate and turn a public request into a 401.
    expect(refreshRequest({ refreshParam: '', adminToken: ADMIN_TOKEN })).toEqual({
      requested: false,
      authorized: false,
    })
  })

  it('accepts both 1 and true so operators do not have to guess the spelling', () => {
    for (const value of ['1', 'true', 'TRUE', ' true ']) {
      expect(
        refreshRequest({ refreshParam: value, authorizationHeader: validHeader, adminToken: ADMIN_TOKEN }),
      ).toEqual({ requested: true, authorized: true })
    }
  })

  it('does not accept arbitrary truthy-looking values', () => {
    // Narrow acceptance keeps the parameter unambiguous — "0" or "yes" must not
    // quietly force an expensive rebuild that the caller did not intend.
    for (const value of ['0', 'false', 'yes', 'refresh']) {
      expect(
        refreshRequest({ refreshParam: value, authorizationHeader: validHeader, adminToken: ADMIN_TOKEN }),
      ).toEqual({ requested: false, authorized: false })
    }
  })

  it('reads the last value when the parameter repeats', () => {
    // Express collapses repeated query parameters into an array. Without handling
    // that shape, `?refresh=1&refresh=1` would read as an object and be dropped.
    expect(
      refreshRequest({ refreshParam: ['1', '1'], authorizationHeader: validHeader, adminToken: ADMIN_TOKEN }),
    ).toEqual({ requested: true, authorized: true })
  })

  it('reports requested-but-unauthorized when the bearer token is wrong', () => {
    // The caller must be told plainly. Silently ignoring the parameter would let an
    // operator believe they had verified a deploy against a rebuilt cache when they
    // were in fact reading the same stale body as everyone else.
    expect(
      refreshRequest({ refreshParam: '1', authorizationHeader: 'Bearer wrong-token', adminToken: ADMIN_TOKEN }),
    ).toEqual({ requested: true, authorized: false })
  })

  it('reports requested-but-unauthorized when no Authorization header is sent', () => {
    expect(refreshRequest({ refreshParam: '1', adminToken: ADMIN_TOKEN })).toEqual({
      requested: true,
      authorized: false,
    })
  })

  it('fails closed when no admin token is configured', () => {
    // An unconfigured server must not expose a free cache-rebuild lever — that is a
    // denial of service vector, since each rebuild is the expensive query the cache exists to avoid.
    expect(refreshRequest({ refreshParam: '1', authorizationHeader: 'Bearer anything' })).toEqual({
      requested: true,
      authorized: false,
    })
  })
})

describe('REFRESH_CACHE_CONTROL', () => {
  it('is no-store so a content delivery network never retains a refresh response', () => {
    // If a refresh response were cacheable, the edge would store it and keep serving
    // it to everyone, defeating the entire point of forcing a rebuild.
    expect(REFRESH_CACHE_CONTROL).toBe('no-store')
  })
})
