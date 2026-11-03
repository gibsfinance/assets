/**
 * The early fetch of the Studio code.
 *
 * What matters is that the route and the early triggers share one import, that a failed
 * early fetch cannot surface as an unhandled rejection, and that the idle trigger always
 * fires, with or without `requestIdleCallback`. The Studio page itself is replaced by a
 * stub, so the tests do not load the real page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./Studio', () => ({ default: () => null }))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loadStudio', () => {
  it('resolves to the module whose default export is the Studio page', async () => {
    const { loadStudio } = await import('./load-studio')
    const loaded = await loadStudio()
    expect(typeof loaded.default).toBe('function')
  })

  it('hands every caller the same page, so the route and a prefetch share one fetch', async () => {
    const { loadStudio } = await import('./load-studio')
    const first = await loadStudio()
    const second = await loadStudio()
    expect(second.default).toBe(first.default)
  })
})

describe('prefetchStudio', () => {
  it('starts the import without returning anything to wait on', async () => {
    const { prefetchStudio } = await import('./load-studio')
    expect(prefetchStudio()).toBeUndefined()
  })

  it('swallows a failed import, because nothing is waiting on it', async () => {
    vi.resetModules()
    vi.doMock('./Studio', () => {
      throw new Error('chunk failed to load')
    })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const { prefetchStudio } = await import('./load-studio')
    prefetchStudio()
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', unhandled)
    vi.doUnmock('./Studio')
    expect(unhandled).not.toHaveBeenCalled()
  })
})

describe('prefetchStudioWhenIdle', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('asks the browser for an idle moment, with a deadline so a busy page cannot postpone it forever', async () => {
    const requestIdleCallback = vi.fn(() => 7)
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    const { prefetchStudioWhenIdle, prefetchStudio, STUDIO_IDLE_TIMEOUT_MILLISECONDS } = await import('./load-studio')
    prefetchStudioWhenIdle()
    expect(requestIdleCallback).toHaveBeenCalledWith(prefetchStudio, { timeout: STUDIO_IDLE_TIMEOUT_MILLISECONDS })
  })

  it('cancels the idle request when the caller leaves the page first', async () => {
    const cancelIdleCallback = vi.fn()
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => 7),
    )
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback)
    const { prefetchStudioWhenIdle } = await import('./load-studio')
    prefetchStudioWhenIdle()()
    expect(cancelIdleCallback).toHaveBeenCalledWith(7)
  })

  it('falls back to a timer where requestIdleCallback is missing', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const { prefetchStudioWhenIdle, prefetchStudio, STUDIO_IDLE_TIMEOUT_MILLISECONDS } = await import('./load-studio')
    prefetchStudioWhenIdle()
    expect(setTimeoutSpy).toHaveBeenCalledWith(prefetchStudio, STUDIO_IDLE_TIMEOUT_MILLISECONDS)
  })

  it('cancels the timer fallback when the caller leaves the page first', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { prefetchStudioWhenIdle } = await import('./load-studio')
    prefetchStudioWhenIdle()()
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })
})
