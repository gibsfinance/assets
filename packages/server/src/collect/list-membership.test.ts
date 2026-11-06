import { describe, expect, it } from 'vitest'
import { nextListVersion, sameMembership, SMALLINT_MAX } from './list-membership'

describe('nextListVersion', () => {
  it('increments the patch number', () => {
    expect(nextListVersion({ major: 0, minor: 0, patch: 0 })).toEqual({ major: 0, minor: 0, patch: 1 })
    expect(nextListVersion({ major: 2, minor: 3, patch: 4 })).toEqual({ major: 2, minor: 3, patch: 5 })
  })

  it('carries into the minor number before a smallint column would overflow', () => {
    expect(nextListVersion({ major: 1, minor: 4, patch: SMALLINT_MAX })).toEqual({ major: 1, minor: 5, patch: 0 })
  })

  it('carries into the major number when minor is also full', () => {
    expect(nextListVersion({ major: 1, minor: SMALLINT_MAX, patch: SMALLINT_MAX })).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    })
  })

  it('always orders above its input', () => {
    const cases = [
      { major: 0, minor: 0, patch: 0 },
      { major: 0, minor: 7, patch: SMALLINT_MAX },
      { major: 3, minor: SMALLINT_MAX, patch: SMALLINT_MAX },
    ]
    for (const version of cases) {
      const next = nextListVersion(version)
      const orderedAbove =
        next.major > version.major ||
        (next.major === version.major && next.minor > version.minor) ||
        (next.major === version.major && next.minor === version.minor && next.patch > version.patch)
      expect(orderedAbove).toBe(true)
    }
  })
})

describe('sameMembership', () => {
  it('is true for the same members in any order', () => {
    expect(sameMembership(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true)
  })

  it('ignores duplicates', () => {
    expect(sameMembership(['a', 'a', 'b'], ['b', 'a'])).toBe(true)
  })

  it('is false when a member left', () => {
    expect(sameMembership(['a', 'b', 'c'], ['a', 'b'])).toBe(false)
  })

  it('is false when a member arrived', () => {
    expect(sameMembership(['a', 'b'], ['a', 'b', 'c'])).toBe(false)
  })

  it('is false when the sizes match but a member was swapped', () => {
    expect(sameMembership(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(false)
  })

  it('treats two empty collections as the same', () => {
    expect(sameMembership([], [])).toBe(true)
  })

  it('is case sensitive, because base58 addresses are', () => {
    expect(sameMembership(['AbC'], ['abc'])).toBe(false)
  })
})
