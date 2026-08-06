import { describe, it, expect, vi } from 'vitest'

// The real `root` reads `process.env.PUBLIC_BASE_URL`, which Vite substitutes at build
// time and which is undefined under Vitest. Pin it so the assertions below are about the
// composition rule rather than about whatever the environment happened to leave behind.
vi.mock('../config', () => ({ root: 'https://api.test' }))

const { getApiUrl } = await import('./index')

/**
 * Every request the interface makes is addressed through this one function, so a change
 * to how it joins base and path — an inserted slash, a dropped base, a trailing one left
 * on — moves every call at once and shows up as a wall of 404s rather than a local bug.
 * These assert the composed URL exactly, not that it merely contains the path.
 */
describe('getApiUrl', () => {
  it('joins the configured base to the path with nothing added between them', () => {
    expect(getApiUrl('/list/search')).toBe('https://api.test/list/search')
  })

  it('preserves a query string rather than re-encoding or truncating at the question mark', () => {
    expect(getApiUrl('/list/merged/default?chainId=eip155:1')).toBe(
      'https://api.test/list/merged/default?chainId=eip155:1',
    )
  })

  it('returns the bare base for an empty path, which is how callers ask for the origin', () => {
    expect(getApiUrl('')).toBe('https://api.test')
  })
})
