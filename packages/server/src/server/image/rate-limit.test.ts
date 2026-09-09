import { describe, it, expect } from 'vitest'
import { createRateLimiter, DEFAULT_PER_IMAGE_LIMIT } from './rate-limit'

/**
 * Every test builds its own controllable clock and passes it in as `now`.
 * The limiter never reads the wall clock in these tests, so a test can state
 * "a minute passed" instead of waiting for one, and no test can spend a
 * budget another test already touched.
 */
const clockAt = (start = 1_000) => {
  let value = start
  return {
    now: () => value,
    advance: (milliseconds: number) => {
      value += milliseconds
    },
  }
}

describe('createRateLimiter', () => {
  it('lets one image spend its request budget in full, then blocks its next request', () => {
    // If this regresses, a single address can request unlimited resize
    // variants of one image, defeating the whole point of a per-image limit.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 3, globalLimit: 100 })

    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(false)
  })

  it('gives two different images their own separate request budgets', () => {
    // If this regresses, one busy image would exhaust a shared per-image
    // counter and block requests for an image that made no requests itself.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 2, globalLimit: 100 })

    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(false)

    expect(limiter.check('image-b')).toBe(true)
    expect(limiter.check('image-b')).toBe(true)
  })

  it('blocks a brand-new image once the shared process budget is spent, even though that image made no requests', () => {
    // If this regresses, a spread of addresses could each stay under their
    // own per-image limit while still overloading the resize pipeline in
    // aggregate, because nothing would ever stop the total across images.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 100, globalLimit: 2 })

    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-b')).toBe(false)
  })

  it('does not spend the shared budget when a request is refused by its own per-image budget', () => {
    // If this regresses, an image that is already blocked would keep eating
    // into the shared budget on every further request, starving every other
    // image faster than the shared limit implies.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 1, globalLimit: 2 })

    expect(limiter.check('image-a')).toBe(true) // spends one of the two shared requests
    expect(limiter.check('image-a')).toBe(false) // refused by its own budget only

    // The shared budget still has exactly one request left, not zero — proof
    // that the refusal above never touched it.
    expect(limiter.check('image-b')).toBe(true)
    expect(limiter.check('image-c')).toBe(false)
  })

  it('keeps a spent per-image budget closed when the clock reaches exactly the window length', () => {
    // The source compares elapsed time with a strict greater-than, so equal
    // to the window length is still the same window. If this regresses to
    // greater-than-or-equal, a client could refresh its budget one tick
    // earlier than the window promises.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 1, globalLimit: 100, windowMs: 1_000 })

    expect(limiter.check('image-a')).toBe(true)
    clock.advance(1_000)
    expect(limiter.check('image-a')).toBe(false)
  })

  it('reopens a spent per-image budget once the clock moves past the window length', () => {
    // If this regresses, an image could stay blocked forever because its
    // window would never be treated as expired.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 1, globalLimit: 100, windowMs: 1_000 })

    expect(limiter.check('image-a')).toBe(true)
    clock.advance(1_001)
    expect(limiter.check('image-a')).toBe(true)
  })

  it('keeps a spent shared budget closed when the clock reaches exactly the window length', () => {
    // Same strict boundary as the per-image window, checked against the
    // shared counter this time so the other comparison is pinned too.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 100, globalLimit: 1, windowMs: 1_000 })

    expect(limiter.check('image-a')).toBe(true)
    clock.advance(1_000)
    expect(limiter.check('image-b')).toBe(false)
  })

  it('reopens a spent shared budget once the clock moves past the window length', () => {
    // If this regresses, the whole process could be locked out of resize
    // requests forever once the shared budget was spent once.
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 100, globalLimit: 1, windowMs: 1_000 })

    expect(limiter.check('image-a')).toBe(true)
    clock.advance(1_001)
    expect(limiter.check('image-b')).toBe(true)
  })

  it('clears every count on reset and re-opens the shared window using the injected clock, not the real one', () => {
    // If reset forgot to clear a counter, a caller would inherit stale
    // history after what it expects to be a clean slate. If reset read the
    // real system clock instead of the injected one, the shared window would
    // never appear to expire in a test that advances only a small fake
    // clock, and the budget would stay closed forever.
    const clock = clockAt(1_000)
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 100, globalLimit: 1, windowMs: 1_000 })

    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.trackedImages()).toBe(1)

    clock.advance(500)
    limiter.reset()
    expect(limiter.trackedImages()).toBe(0) // the per-image record is forgotten

    expect(limiter.check('image-a')).toBe(true) // the shared count was forgotten too
    expect(limiter.check('image-b')).toBe(false) // and immediately spent again by one request

    clock.advance(1_000_000)
    expect(limiter.check('image-c')).toBe(true)
  })

  it('reports the number of tracked images and sweeps out only the ones whose window has expired', () => {
    // If this regresses, the map of tracked images either never shrinks
    // (an unbounded memory leak under real traffic) or drops entries that
    // are still live, silently handing those images a fresh budget early.
    const clock = clockAt(0)
    const limiter = createRateLimiter({
      now: clock.now,
      perImageLimit: 10,
      globalLimit: 100,
      windowMs: 1_000,
      sweepThreshold: 3,
    })

    expect(limiter.check('image-a')).toBe(true) // window opens at time zero
    expect(limiter.trackedImages()).toBe(1)

    clock.advance(2_000) // image-a's window is now well past windowMs
    expect(limiter.check('image-b')).toBe(true)
    expect(limiter.check('image-c')).toBe(true)
    expect(limiter.trackedImages()).toBe(3) // at the sweep threshold, no sweep yet

    expect(limiter.check('image-d')).toBe(true) // crosses the threshold, triggers the sweep
    expect(limiter.trackedImages()).toBe(3) // image-a's expired window is gone, the three live ones remain
  })

  it('uses the injected per-image limit instead of the default of five', () => {
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 2, globalLimit: 100 })

    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(false) // the default limit of five would still allow this request
  })

  it('uses the injected shared limit instead of the default of one hundred', () => {
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 10, globalLimit: 3 })

    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(true)
    expect(limiter.check('image-a')).toBe(false) // the default shared limit of one hundred would still allow this request
  })

  it('uses the injected window length instead of the default of one minute', () => {
    const clock = clockAt()
    const limiter = createRateLimiter({ now: clock.now, perImageLimit: 1, globalLimit: 100, windowMs: 200 })

    expect(limiter.check('image-a')).toBe(true)
    clock.advance(201)
    expect(limiter.check('image-a')).toBe(true) // the default window of one minute would not have reopened yet
  })

  it('spends exactly the exported default per-image limit when a limiter is built with no options', () => {
    // This pins the wiring itself: the exported constant must be the number
    // that a production limiter, built with createRateLimiter(), actually
    // enforces — not a number that happens to match it today.
    const limiter = createRateLimiter()

    for (let requestNumber = 0; requestNumber < DEFAULT_PER_IMAGE_LIMIT; requestNumber += 1) {
      expect(limiter.check('image-a')).toBe(true)
    }
    expect(limiter.check('image-a')).toBe(false)
  })
})
