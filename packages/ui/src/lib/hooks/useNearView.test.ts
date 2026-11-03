import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNearView, NEAR_VIEW_MARGIN } from './useNearView'

afterEach(() => vi.unstubAllGlobals())

describe('useNearView without IntersectionObserver', () => {
  // A browser without the observer must still get its deferred work done,
  // so the element counts as near rather than staying plain forever.
  it('treats the element as near so deferred work is not lost', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { result } = renderHook(() => useNearView({ current: document.createElement('div') }))
    expect(result.current).toBe(true)
  })
})

describe('useNearView with no element', () => {
  it('treats a missing element as near rather than waiting forever', () => {
    const { result } = renderHook(() => useNearView({ current: null }))
    expect(result.current).toBe(true)
  })
})

describe('useNearView with IntersectionObserver', () => {
  it('stays false until the element intersects, then latches and disconnects', () => {
    const disconnect = vi.fn()
    let report: IntersectionObserverCallback = () => {}
    let options: IntersectionObserverInit | undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          report = callback
          options = init
        }
        observe = vi.fn()
        disconnect = disconnect
      },
    )
    const element = document.createElement('div')
    const { result } = renderHook(() => useNearView({ current: element }))
    expect(result.current).toBe(false)
    expect(options?.rootMargin).toBe(NEAR_VIEW_MARGIN)

    act(() => report([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(result.current).toBe(false)

    act(() => report([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(result.current).toBe(true)
    expect(disconnect).toHaveBeenCalled()
  })
})
