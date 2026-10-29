import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not run the callback before the wait has passed', () => {
    const callback = vi.fn()
    debounce(callback, 100)('a')
    vi.advanceTimersByTime(99)
    expect(callback).not.toHaveBeenCalled()
  })

  it('runs the callback once, with the arguments, after the wait', () => {
    const callback = vi.fn()
    debounce(callback, 100)('a', 1)
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('a', 1)
  })

  it('restarts the wait on every call and runs only the last one', () => {
    const callback = vi.fn()
    const debounced = debounce(callback, 100)
    debounced('first')
    vi.advanceTimersByTime(80)
    debounced('second')
    vi.advanceTimersByTime(80)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith('second')
  })

  it('drops the pending call when cancelled', () => {
    const callback = vi.fn()
    const debounced = debounce(callback, 100)
    debounced('a')
    debounced.cancel()
    vi.advanceTimersByTime(1000)
    expect(callback).not.toHaveBeenCalled()
  })

  it('can be cancelled with nothing pending', () => {
    expect(() => debounce(vi.fn(), 100).cancel()).not.toThrow()
  })

  it('runs again for a call made after an earlier call has run', () => {
    const callback = vi.fn()
    const debounced = debounce(callback, 100)
    debounced('a')
    vi.advanceTimersByTime(100)
    debounced('b')
    vi.advanceTimersByTime(100)
    expect(callback.mock.calls).toEqual([['a'], ['b']])
  })
})
