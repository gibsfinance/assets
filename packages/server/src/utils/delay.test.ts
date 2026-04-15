import { describe, it, expect, vi, afterEach } from 'vitest'
import { delay } from './delay'

describe('delay', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the specified duration', async () => {
    vi.useFakeTimers()
    const p = delay(100)
    vi.advanceTimersByTime(100)
    await expect(p).resolves.toBeUndefined()
  })

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('already aborted'))
    await expect(delay(5000, controller.signal)).rejects.toThrow('already aborted')
  })

  it('rejects mid-delay when signal aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const p = delay(5000, controller.signal)
    vi.advanceTimersByTime(100)
    controller.abort(new Error('mid abort'))
    await expect(p).rejects.toThrow('mid abort')
  })

  it('resolves normally when signal never aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const p = delay(200, controller.signal)
    vi.advanceTimersByTime(200)
    await expect(p).resolves.toBeUndefined()
  })
})
