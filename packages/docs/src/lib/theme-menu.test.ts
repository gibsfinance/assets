import { describe, expect, it } from 'vitest'
import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  isNavigationKey,
  nextItemIndex,
  parseThemeChoice,
  resolveTheme,
  storedValueFor,
} from './theme-menu.ts'

describe('theme menu constants', () => {
  it('lists the three choices, auto first, and uses the key Starlight reads', () => {
    expect(THEME_CHOICES).toEqual(['auto', 'light', 'dark'])
    expect(THEME_STORAGE_KEY).toBe('starlight-theme')
  })
})

describe('parseThemeChoice', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['auto', 'auto'],
    ['', 'auto'],
    [null, 'auto'],
    ['sepia', 'auto'],
    [3, 'auto'],
  ])('reads %j as %s', (value, expected) => {
    expect(parseThemeChoice(value)).toBe(expected)
  })
})

describe('storedValueFor', () => {
  it('stores nothing for auto and the name for the others, as Starlight does', () => {
    expect(storedValueFor('auto')).toBe('')
    expect(storedValueFor('light')).toBe('light')
    expect(storedValueFor('dark')).toBe('dark')
  })
})

describe('resolveTheme', () => {
  it('keeps an explicit choice whatever the system prefers', () => {
    expect(resolveTheme('dark', { systemPrefersLight: true })).toBe('dark')
    expect(resolveTheme('light', { systemPrefersLight: false })).toBe('light')
  })

  it('follows the system for auto', () => {
    expect(resolveTheme('auto', { systemPrefersLight: true })).toBe('light')
    expect(resolveTheme('auto', { systemPrefersLight: false })).toBe('dark')
  })
})

describe('isNavigationKey', () => {
  it('accepts the four navigation keys only', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) expect(isNavigationKey(key)).toBe(true)
    for (const key of ['Enter', 'a', 'Tab']) expect(isNavigationKey(key)).toBe(false)
  })
})

describe('nextItemIndex', () => {
  it('jumps to the ends with Home and End', () => {
    expect(nextItemIndex('Home', { current: 2, count: 3 })).toBe(0)
    expect(nextItemIndex('End', { current: 0, count: 3 })).toBe(2)
  })

  it('steps and wraps with the arrow keys', () => {
    expect(nextItemIndex('ArrowDown', { current: 0, count: 3 })).toBe(1)
    expect(nextItemIndex('ArrowDown', { current: 2, count: 3 })).toBe(0)
    expect(nextItemIndex('ArrowUp', { current: 1, count: 3 })).toBe(0)
    expect(nextItemIndex('ArrowUp', { current: 0, count: 3 })).toBe(2)
  })

  it('starts from the first item going down and the last going up when nothing is highlighted', () => {
    expect(nextItemIndex('ArrowDown', { current: -1, count: 3 })).toBe(0)
    expect(nextItemIndex('ArrowUp', { current: -1, count: 3 })).toBe(2)
  })
})
