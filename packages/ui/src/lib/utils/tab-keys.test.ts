import { describe, it, expect } from 'vitest'
import { nextTabIndex } from './tab-keys'

describe('nextTabIndex', () => {
  it('moves one tab to the right, and wraps from the last tab back to the first', () => {
    expect(nextTabIndex({ current: 0, key: 'ArrowRight', count: 4 })).toBe(1)
    expect(nextTabIndex({ current: 3, key: 'ArrowRight', count: 4 })).toBe(0)
  })

  it('moves one tab to the left, and wraps from the first tab to the last', () => {
    expect(nextTabIndex({ current: 2, key: 'ArrowLeft', count: 4 })).toBe(1)
    expect(nextTabIndex({ current: 0, key: 'ArrowLeft', count: 4 })).toBe(3)
  })

  it('goes to the first tab on Home and the last on End, wherever focus is', () => {
    expect(nextTabIndex({ current: 2, key: 'Home', count: 4 })).toBe(0)
    expect(nextTabIndex({ current: 1, key: 'End', count: 4 })).toBe(3)
  })

  it('does not move for any other key, so typing and Tab keep their usual behaviour', () => {
    expect(nextTabIndex({ current: 1, key: 'a', count: 4 })).toBeNull()
    expect(nextTabIndex({ current: 1, key: 'Tab', count: 4 })).toBeNull()
  })
})
