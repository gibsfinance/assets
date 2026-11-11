import { describe, expect, it } from 'vitest'
import { readSwitch } from './read-switch'

describe('readSwitch', () => {
  it.each(['true', 'TRUE', ' 1 ', 'yes', 'On'])('reads %j as on, whatever the default', (rawValue) => {
    expect(readSwitch(rawValue, false)).toBe(true)
  })

  it.each(['false', 'FALSE', ' 0 ', 'no', 'Off'])('reads %j as off, whatever the default', (rawValue) => {
    expect(readSwitch(rawValue, true)).toBe(false)
  })

  it.each([undefined, '', '   ', 'maybe', '2', 'nope'])('returns the default for %j in both directions', (rawValue) => {
    expect(readSwitch(rawValue, true)).toBe(true)
    expect(readSwitch(rawValue, false)).toBe(false)
  })
})
