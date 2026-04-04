import { describe, it, expect } from 'vitest'
import { timeout } from './timeout'

describe('timeout', () => {
  it('resolves after the specified duration', async () => {
    const start = Date.now()
    const t = timeout(50)
    await t.promise
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })

  it('returns a clearable timeout', () => {
    const t = timeout(10_000)
    // Should not throw
    t.clear()
    expect(t.timeoutId()).toBeDefined()
  })

  it('exposes the timeout ID', () => {
    const t = timeout(100)
    const id = t.timeoutId()
    expect(id).toBeDefined()
    t.clear()
  })
})
