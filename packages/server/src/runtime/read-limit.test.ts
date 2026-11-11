import { describe, expect, it } from 'vitest'
import { readLimit } from './read-limit'

describe('readLimit', () => {
  it('returns the number a valid value spells', () => {
    expect(readLimit('3', 8)).toBe(3)
    expect(readLimit(' 12 ', 8)).toBe(12)
  })

  it.each([undefined, '', '   ', '0', '-2', '1.5', 'many', 'NaN', 'Infinity'])(
    'falls back to the default for %j, so a typo can never switch a limit off',
    (rawValue) => {
      expect(readLimit(rawValue, 8)).toBe(8)
    },
  )
})
