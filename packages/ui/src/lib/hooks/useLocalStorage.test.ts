/**
 * Tests for useLocalStorage — the persisted-state hook behind user settings.
 *
 * Why: it must survive a first visit (no stored value), a corrupt or
 * hand-edited storage entry (never throw on mount), and the React functional
 * updater form. A regression in any of those silently breaks every setting
 * that rides on this hook, so the intent is pinned here.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

beforeEach(() => {
  localStorage.clear()
})

describe('useLocalStorage', () => {
  it('uses the initial value when nothing is stored', () => {
    const { result } = renderHook(() => useLocalStorage('missing', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  it('rehydrates a previously stored value on mount', () => {
    localStorage.setItem('count', JSON.stringify(42))
    const { result } = renderHook(() => useLocalStorage('count', 0))
    expect(result.current[0]).toBe(42)
  })

  it('falls back to the initial value when stored JSON is corrupt (no throw)', () => {
    localStorage.setItem('broken', 'not-json{')
    const { result } = renderHook(() => useLocalStorage('broken', 'safe'))
    expect(result.current[0]).toBe('safe')
  })

  it('persists a direct value and exposes it as state', () => {
    const { result } = renderHook(() => useLocalStorage('theme', 'light'))
    act(() => result.current[1]('dark'))
    expect(result.current[0]).toBe('dark')
    expect(JSON.parse(localStorage.getItem('theme')!)).toBe('dark')
  })

  it('supports the functional updater form against the previous value', () => {
    const { result } = renderHook(() => useLocalStorage('n', 1))
    act(() => result.current[1]((prev) => prev + 1))
    act(() => result.current[1]((prev) => prev + 1))
    expect(result.current[0]).toBe(3)
    expect(JSON.parse(localStorage.getItem('n')!)).toBe(3)
  })

  it('serializes structured values round-trip through storage', () => {
    const { result } = renderHook(() => useLocalStorage<{ a: number[] }>('obj', { a: [] }))
    act(() => result.current[1]({ a: [1, 2, 3] }))
    expect(result.current[0]).toEqual({ a: [1, 2, 3] })
    expect(JSON.parse(localStorage.getItem('obj')!)).toEqual({ a: [1, 2, 3] })
  })

  it('writes under the exact key it was given', () => {
    const { result } = renderHook(() => useLocalStorage('showTestnets', false))
    act(() => result.current[1](true))
    expect(localStorage.getItem('showTestnets')).toBe('true')
  })
})
