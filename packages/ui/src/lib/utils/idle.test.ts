import { describe, it, expect, vi, afterEach } from 'vitest'
import { scheduleIdle } from './idle'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('scheduleIdle with requestIdleCallback', () => {
  it('hands the work to the idle callback and cancels through its handle', () => {
    const request = vi.fn(() => 7)
    const cancel = vi.fn()
    vi.stubGlobal('requestIdleCallback', request)
    vi.stubGlobal('cancelIdleCallback', cancel)
    const work = vi.fn()
    const stop = scheduleIdle(work)
    expect(request).toHaveBeenCalledWith(work)
    stop()
    expect(cancel).toHaveBeenCalledWith(7)
  })
})

describe('scheduleIdle without requestIdleCallback', () => {
  it('runs the work from a timer when the idle API is missing', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const work = vi.fn()
    scheduleIdle(work)
    expect(work).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('does not run the work once cancelled', () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const work = vi.fn()
    scheduleIdle(work)()
    vi.runAllTimers()
    expect(work).not.toHaveBeenCalled()
  })
})
