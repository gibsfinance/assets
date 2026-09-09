import { describe, expect, it } from 'vitest'
import { isImageEndpoint, filterEndpoints } from './endpoint-filter'

describe('isImageEndpoint', () => {
  it('is true for a path that contains /image/', () => {
    expect(isImageEndpoint('/image/1/0xabc')).toBe(true)
  })

  it('is true for a path that contains /sprite/', () => {
    expect(isImageEndpoint('/sprite/1')).toBe(true)
  })

  it('is false for a JSON endpoint', () => {
    expect(isImageEndpoint('/list/tokens')).toBe(false)
  })

  it('is false for a path that only mentions the word image, without the slashes', () => {
    // A wrong match here renders binary into a code block on the
    // documentation page, so a near-miss on the word matters as much as the
    // true positive above.
    expect(isImageEndpoint('/list/image-heavy')).toBe(false)
  })
})

type Endpoint = { path: string; description: string }

describe('filterEndpoints', () => {
  const endpoints: Endpoint[] = [
    { path: '/image/1/0xabc', description: 'Fetch a token icon' },
    { path: '/list/tokens', description: 'List every known token' },
    { path: '/network/1', description: 'Read network metadata' },
  ]

  it('matches on the path', () => {
    const result = filterEndpoints(endpoints, 'tokens')
    expect(result).toEqual([{ path: '/list/tokens', description: 'List every known token' }])
  })

  it('matches on the description separately from the path', () => {
    const result = filterEndpoints(endpoints, 'metadata')
    expect(result).toEqual([{ path: '/network/1', description: 'Read network metadata' }])
  })

  it('finds a lowercase path from an upper-case query', () => {
    const result = filterEndpoints(endpoints, 'TOKENS')
    expect(result).toEqual([{ path: '/list/tokens', description: 'List every known token' }])
  })

  it('finds an upper-case description from a lowercase query', () => {
    const mixedCase: Endpoint[] = [{ path: '/network/1', description: 'Read Network Metadata' }]
    const result = filterEndpoints(mixedCase, 'metadata')
    expect(result).toEqual(mixedCase)
  })

  it('returns the same array reference for a blank query, without copying', () => {
    // Thousands of rows re-copy on every keystroke otherwise, so this is a
    // deliberate identity claim, not an accident of implementation.
    expect(filterEndpoints(endpoints, '')).toBe(endpoints)
  })

  it('returns the same array reference for a whitespace-only query', () => {
    expect(filterEndpoints(endpoints, '   ')).toBe(endpoints)
  })

  it('returns an empty array when the query matches nothing', () => {
    expect(filterEndpoints(endpoints, 'nonexistent')).toEqual([])
  })
})
