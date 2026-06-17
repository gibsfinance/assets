/**
 * Behavioral tests for useTokenBrowser — the list-selection state behind the
 * Studio token browser. It tracks which token lists are loaded and which are
 * enabled. These tests pin the non-obvious rules: loading a list auto-enables
 * it, toggleAll is scoped to loaded lists, and every mutation returns a fresh
 * Set/Map so React re-renders (stale-identity bugs would silently break the
 * browser's checkboxes).
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTokenBrowser } from './useTokenBrowser'
import type { Token } from '../types'

const makeToken = (overrides: Partial<Token> = {}): Token => ({
  chainId: 1,
  address: '0x0000000000000000000000000000000000000001',
  name: 'Token',
  symbol: 'TKN',
  decimals: 18,
  hasIcon: true,
  sourceList: 'list-a',
  ...overrides,
})

describe('useTokenBrowser', () => {
  it('starts with no enabled lists and no loaded tokens', () => {
    const { result } = renderHook(() => useTokenBrowser())
    expect(result.current.enabledLists.size).toBe(0)
    expect(result.current.tokensByList.size).toBe(0)
  })

  describe('toggleList', () => {
    it('adds a list when enabled and removes it when disabled', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => result.current.toggleList('list-a', true))
      expect(result.current.enabledLists.has('list-a')).toBe(true)
      act(() => result.current.toggleList('list-a', false))
      expect(result.current.enabledLists.has('list-a')).toBe(false)
    })

    it('disabling a list that was never enabled is a harmless no-op', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => result.current.toggleList('ghost', false))
      expect(result.current.enabledLists.size).toBe(0)
    })

    it('returns a new Set instance on every toggle (so React re-renders)', () => {
      const { result } = renderHook(() => useTokenBrowser())
      const before = result.current.enabledLists
      act(() => result.current.toggleList('list-a', true))
      expect(result.current.enabledLists).not.toBe(before)
    })
  })

  describe('setListTokens', () => {
    it('stores the tokens for a list and auto-enables that list', () => {
      const { result } = renderHook(() => useTokenBrowser())
      const tokens = [makeToken(), makeToken({ address: '0x2' })]
      act(() => result.current.setListTokens('list-a', tokens))
      expect(result.current.tokensByList.get('list-a')).toEqual(tokens)
      expect(result.current.enabledLists.has('list-a')).toBe(true)
    })

    it('re-enables a list that the user had previously toggled off', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => result.current.setListTokens('list-a', [makeToken()]))
      act(() => result.current.toggleList('list-a', false))
      expect(result.current.enabledLists.has('list-a')).toBe(false)
      act(() => result.current.setListTokens('list-a', [makeToken()]))
      expect(result.current.enabledLists.has('list-a')).toBe(true)
    })

    it('replaces the tokens when the same list is set again', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => result.current.setListTokens('list-a', [makeToken({ symbol: 'OLD' })]))
      act(() => result.current.setListTokens('list-a', [makeToken({ symbol: 'NEW' })]))
      const tokens = result.current.tokensByList.get('list-a')!
      expect(tokens).toHaveLength(1)
      expect(tokens[0].symbol).toBe('NEW')
    })
  })

  describe('toggleAll', () => {
    it('enables exactly the loaded lists when turned on', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => {
        result.current.setListTokens('list-a', [makeToken()])
        result.current.setListTokens('list-b', [makeToken({ sourceList: 'list-b' })])
      })
      act(() => result.current.toggleList('list-a', false)) // turn one off first
      act(() => result.current.toggleAll(true))
      expect(result.current.enabledLists.has('list-a')).toBe(true)
      expect(result.current.enabledLists.has('list-b')).toBe(true)
      expect(result.current.enabledLists.size).toBe(2)
    })

    it('clears all enabled lists when turned off', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => {
        result.current.setListTokens('list-a', [makeToken()])
        result.current.setListTokens('list-b', [makeToken({ sourceList: 'list-b' })])
      })
      act(() => result.current.toggleAll(false))
      expect(result.current.enabledLists.size).toBe(0)
    })

    it('enabling all with no loaded lists yields an empty set', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => result.current.toggleAll(true))
      expect(result.current.enabledLists.size).toBe(0)
    })
  })

  describe('clearTokens', () => {
    it('empties both the loaded tokens and the enabled set', () => {
      const { result } = renderHook(() => useTokenBrowser())
      act(() => {
        result.current.setListTokens('list-a', [makeToken()])
        result.current.setListTokens('list-b', [makeToken({ sourceList: 'list-b' })])
      })
      act(() => result.current.clearTokens())
      expect(result.current.tokensByList.size).toBe(0)
      expect(result.current.enabledLists.size).toBe(0)
    })
  })
})
