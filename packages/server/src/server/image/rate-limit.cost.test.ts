import { describe, it, expect } from 'vitest'
import { createRateLimiter } from './rate-limit'

/** A clock the test moves by hand. */
function clock(start = 0) {
  let at = start
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

describe('rate limiter with a weight per request', () => {
  it('spends the weight, not one, from both budgets', () => {
    const limiter = createRateLimiter({ perImageLimit: 10, globalLimit: 10, now: clock().now })
    expect(limiter.check('a', 6)).toBe(true)
    expect(limiter.canSpend('a', 4)).toBe(true)
    expect(limiter.canSpend('a', 5)).toBe(false)
    expect(limiter.check('a', 5)).toBe(false)
    expect(limiter.check('a', 4)).toBe(true)
  })

  it('refuses a weight that would pass the global budget, even when the key has room', () => {
    const limiter = createRateLimiter({ perImageLimit: 100, globalLimit: 10, now: clock().now })
    expect(limiter.check('a', 8)).toBe(true)
    expect(limiter.check('b', 3)).toBe(false)
    expect(limiter.canSpend('b', 2)).toBe(true)
  })

  it('leaves neither budget moved by a refusal', () => {
    const limiter = createRateLimiter({ perImageLimit: 10, globalLimit: 10, now: clock().now })
    expect(limiter.check('a', 11)).toBe(false)
    expect(limiter.canSpend('a', 10)).toBe(true)
  })

  it('still counts one per request when no weight is given, as before', () => {
    const limiter = createRateLimiter({ perImageLimit: 2, globalLimit: 2, now: clock().now })
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false)
  })

  it('renews a window after its length, so a weight is spendable again', () => {
    const time = clock()
    const limiter = createRateLimiter({ perImageLimit: 5, globalLimit: 5, windowMs: 1000, now: time.now })
    expect(limiter.check('a', 5)).toBe(true)
    expect(limiter.canSpend('a', 1)).toBe(false)
    time.advance(1001)
    expect(limiter.canSpend('a', 5)).toBe(true)
  })
})
