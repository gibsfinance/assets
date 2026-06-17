/**
 * Behavioral tests for StudioContext — the Studio's state machine.
 *
 * Why: every Studio surface (browser, configurator, code output) reads and
 * mutates this one store. These tests pin the *intent* of each transition —
 * what selecting a token does to the chain and active tab, what reset keeps
 * vs. clears, which slices persist to localStorage and which deliberately do
 * not — so a refactor that quietly changes those semantics fails here rather
 * than in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { StudioProvider, useStudio } from './StudioContext'
import type { Token } from '../types'

const STORAGE_KEY = 'gib-studio-state'

const TOKEN: Token = {
  chainId: 369,
  address: '0x1234567890123456789012345678901234567890',
  name: 'PulseX',
  symbol: 'PLSX',
  decimals: 18,
  hasIcon: true,
  sourceList: 'pulsex',
}

const wrapper = ({ children }: { children: ReactNode }) => createElement(StudioProvider, null, children)

const renderStudio = () => renderHook(() => useStudio(), { wrapper })

beforeEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Provider guard
// ---------------------------------------------------------------------------

describe('useStudio guard', () => {
  it('throws a clear error when used outside a StudioProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useStudio())).toThrow('useStudio must be used within StudioProvider')
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('starts with the documented defaults when storage is empty', () => {
    const { result } = renderStudio()
    expect(result.current.selectedToken).toBeNull()
    expect(result.current.selectedChainId).toBeNull()
    expect(result.current.appearance).toEqual({
      width: 64,
      height: 64,
      shape: 'circle',
      borderRadius: 8,
      padding: 0,
      shadow: 'none',
      backgroundColor: 'transparent',
    })
    expect(result.current.badge.enabled).toBe(false)
    expect(result.current.badge.ringEnabled).toBe(true)
    expect(result.current.codeFormat).toBe('sdk')
    expect(result.current.codeMode).toBe('snippet')
    expect(result.current.resolutionOrder).toBeNull()
    expect(result.current.activeTab).toBe('browse')
  })
})

// ---------------------------------------------------------------------------
// Token + chain selection
// ---------------------------------------------------------------------------

describe('selectToken', () => {
  it('stores the token, derives the chain id from it, and jumps to the configure tab', () => {
    const { result } = renderStudio()
    act(() => result.current.selectToken(TOKEN))
    expect(result.current.selectedToken).toEqual(TOKEN)
    // chainId is derived from the token and stored as a string
    expect(result.current.selectedChainId).toBe('369')
    expect(result.current.activeTab).toBe('configure')
  })
})

describe('selectChain', () => {
  it('sets the chain id while keeping the already-selected token', () => {
    const { result } = renderStudio()
    act(() => result.current.selectToken(TOKEN))
    act(() => result.current.selectChain('1'))
    expect(result.current.selectedChainId).toBe('1')
    expect(result.current.selectedToken).toEqual(TOKEN)
  })

  it('clears the selected token when the chain is cleared (null)', () => {
    const { result } = renderStudio()
    act(() => result.current.selectToken(TOKEN))
    act(() => result.current.selectChain(null))
    expect(result.current.selectedChainId).toBeNull()
    expect(result.current.selectedToken).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Partial-merge updaters
// ---------------------------------------------------------------------------

describe('updateAppearance', () => {
  it('merges the patch over existing appearance without touching siblings', () => {
    const { result } = renderStudio()
    act(() => result.current.updateAppearance({ width: 128, shape: 'square' }))
    expect(result.current.appearance.width).toBe(128)
    expect(result.current.appearance.shape).toBe('square')
    // untouched fields keep their defaults
    expect(result.current.appearance.height).toBe(64)
    expect(result.current.appearance.borderRadius).toBe(8)
  })
})

describe('updateBadge', () => {
  it('merges the patch over existing badge config', () => {
    const { result } = renderStudio()
    act(() => result.current.updateBadge({ enabled: true, angleDeg: 45 }))
    expect(result.current.badge.enabled).toBe(true)
    expect(result.current.badge.angleDeg).toBe(45)
    // untouched field keeps its default
    expect(result.current.badge.ringColor).toBe('#09090b')
  })
})

// ---------------------------------------------------------------------------
// Simple setters
// ---------------------------------------------------------------------------

describe('format / mode / resolution / tab setters', () => {
  it('each setter updates only its own slice', () => {
    const { result } = renderStudio()
    act(() => result.current.setCodeFormat('react'))
    act(() => result.current.setCodeMode('component'))
    act(() => result.current.setResolutionOrder(['pulsex', 'coingecko']))
    act(() => result.current.setActiveTab('editor'))
    expect(result.current.codeFormat).toBe('react')
    expect(result.current.codeMode).toBe('component')
    expect(result.current.resolutionOrder).toEqual(['pulsex', 'coingecko'])
    expect(result.current.activeTab).toBe('editor')
  })
})

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe('reset', () => {
  it('restores appearance/badge/format/mode/resolution to defaults but keeps the selected token, chain, and tab', () => {
    const { result } = renderStudio()
    act(() => result.current.selectToken(TOKEN)) // token + chain + configure tab
    act(() => {
      result.current.updateAppearance({ width: 200, shadow: 'strong' })
      result.current.updateBadge({ enabled: true })
      result.current.setCodeFormat('html')
      result.current.setCodeMode('component')
      result.current.setResolutionOrder(['pulsex'])
    })

    act(() => result.current.reset())

    // config slices are back to defaults
    expect(result.current.appearance.width).toBe(64)
    expect(result.current.appearance.shadow).toBe('none')
    expect(result.current.badge.enabled).toBe(false)
    expect(result.current.codeFormat).toBe('sdk')
    expect(result.current.codeMode).toBe('snippet')
    expect(result.current.resolutionOrder).toBeNull()
    // navigation / selection survive a reset
    expect(result.current.selectedToken).toEqual(TOKEN)
    expect(result.current.selectedChainId).toBe('369')
    expect(result.current.activeTab).toBe('configure')
  })
})

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe('persistence', () => {
  it('persists only the preference slices, never the token / chain / tab', async () => {
    const { result } = renderStudio()
    act(() => {
      result.current.selectToken(TOKEN)
      result.current.updateAppearance({ width: 96 })
    })

    // Poll for the debounced write carrying our change — an earlier
    // mount-time save may land first, so assert on the value, not presence.
    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(raw!).appearance.width).toBe(96)
    })

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    // navigational / selection state is intentionally excluded
    expect(persisted).not.toHaveProperty('selectedToken')
    expect(persisted).not.toHaveProperty('selectedChainId')
    expect(persisted).not.toHaveProperty('activeTab')
  })

  it('rehydrates persisted preferences on mount, merged over defaults', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appearance: { width: 200 },
        codeFormat: 'html',
        resolutionOrder: ['pulsex'],
      }),
    )
    const { result } = renderStudio()
    expect(result.current.appearance.width).toBe(200)
    // a missing persisted field still falls back to the default
    expect(result.current.appearance.height).toBe(64)
    expect(result.current.codeFormat).toBe('html')
    expect(result.current.resolutionOrder).toEqual(['pulsex'])
  })

  it('falls back to defaults when persisted JSON is corrupt (no throw)', () => {
    localStorage.setItem(STORAGE_KEY, 'this is not json{')
    const { result } = renderStudio()
    expect(result.current.appearance.width).toBe(64)
    expect(result.current.codeFormat).toBe('sdk')
  })
})

// ---------------------------------------------------------------------------
// Cross-page chain hand-off (Home page writes selectedChainId to localStorage)
// ---------------------------------------------------------------------------

describe('cross-page chain pre-selection', () => {
  it('adopts a selectedChainId left in localStorage and consumes it', () => {
    localStorage.setItem('selectedChainId', '369')
    const { result } = renderStudio()
    expect(result.current.selectedChainId).toBe('369')
    // it is consumed exactly once so a later visit does not re-trigger it
    expect(localStorage.getItem('selectedChainId')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Debounced save coalescing
// ---------------------------------------------------------------------------

describe('debounced persistence', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst of rapid updates into a single write', () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderStudio()
    setItem.mockClear() // ignore the initial mount's scheduled save

    act(() => {
      result.current.updateAppearance({ width: 70 })
      result.current.updateAppearance({ width: 80 })
      result.current.updateAppearance({ width: 90 })
    })
    // nothing written yet — still inside the debounce window
    expect(setItem).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const studioWrites = setItem.mock.calls.filter(([key]) => key === STORAGE_KEY)
    expect(studioWrites).toHaveLength(1)
    expect(JSON.parse(studioWrites[0][1] as string).appearance.width).toBe(90)
    setItem.mockRestore()
  })
})
