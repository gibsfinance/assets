/**
 * Tests for SettingsContext — the testnet-visibility toggle store.
 *
 * Why: this gates whether testnet chains appear across the whole app, and the
 * value must persist between sessions. The tests pin the safe default (testnets
 * hidden), the provider-backed persistence, and the documented no-provider
 * fallback so a consumer rendered outside the provider degrades quietly rather
 * than crashing.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SettingsProvider, useSettings } from './SettingsContext'

beforeEach(() => {
  localStorage.clear()
})

const wrapper = ({ children }: { children: ReactNode }) => createElement(SettingsProvider, null, children)

describe('SettingsContext', () => {
  it('defaults to hiding testnets when nothing is persisted', () => {
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.showTestnets).toBe(false)
  })

  it('rehydrates a persisted preference on mount', () => {
    localStorage.setItem('showTestnets', JSON.stringify(true))
    const { result } = renderHook(() => useSettings(), { wrapper })
    expect(result.current.showTestnets).toBe(true)
  })

  it('toggles the value and persists it to localStorage', () => {
    const { result } = renderHook(() => useSettings(), { wrapper })
    act(() => result.current.setShowTestnets(true))
    expect(result.current.showTestnets).toBe(true)
    expect(localStorage.getItem('showTestnets')).toBe('true')
  })

  it('exposes a safe default when used without a provider', () => {
    // No wrapper: consumers fall back to the default context value rather than
    // throwing — testnets hidden and a no-op setter.
    const { result } = renderHook(() => useSettings())
    expect(result.current.showTestnets).toBe(false)
    expect(() => result.current.setShowTestnets(true)).not.toThrow()
  })
})
