/**
 * A fixed-window rate limiter for image variant production.
 *
 * Resizing is the one image path that costs real processor time, so it carries
 * two budgets at once: a small one per image, which stops a single address
 * being hammered into a hundred variants, and a larger one across the whole
 * process, which stops a spread of addresses doing the same thing in aggregate.
 *
 * The clock and both budgets are arguments rather than constants. That is not
 * a testing convenience — it is what lets a test state the passage of a minute
 * instead of waiting for one, and what lets each test hold its own counters.
 * A limiter that reads the wall clock and keeps its counts in module scope has
 * exactly one instance per process, so every test that touches it spends from
 * the same budget as every test before it, and the suite passes or fails on
 * the order the files happened to run in.
 */

/** One counting window: how many requests, and when the window opened. */
interface RateWindow {
  count: number
  windowStart: number
}

export interface RateLimiterOptions {
  /** Reads the current time in milliseconds. Defaults to the wall clock. */
  now?: () => number
  /** Requests allowed per image within one window. */
  perImageLimit?: number
  /** Requests allowed across every image within one window. */
  globalLimit?: number
  /** Window length in milliseconds. */
  windowMs?: number
  /**
   * Number of tracked images above which expired entries are swept. The sweep
   * is a housekeeping measure against unbounded growth, not part of the limit:
   * an expired window answers the same way whether or not it is still in the map.
   */
  sweepThreshold?: number
}

export interface RateLimiter {
  /** Records one request against both budgets. Returns false when either is spent. */
  check: (imageHash: string) => boolean
  /** Forgets every window, global and per image. */
  reset: () => void
  /** How many images currently have a window. Housekeeping only. */
  trackedImages: () => number
}

export const DEFAULT_PER_IMAGE_LIMIT = 5
export const DEFAULT_GLOBAL_LIMIT = 100
export const DEFAULT_WINDOW_MS = 60_000
export const DEFAULT_SWEEP_THRESHOLD = 1000

/**
 * Build a limiter with its own counters.
 *
 * @param options - Clock and budgets. Every field has a production default, so
 *   `createRateLimiter()` yields the limiter the image route uses.
 */
export const createRateLimiter = (options: RateLimiterOptions = {}): RateLimiter => {
  const {
    // Called through rather than captured, so a clock replaced after this
    // limiter was built — a test installing fake timers, say — still applies.
    now = () => Date.now(),
    perImageLimit = DEFAULT_PER_IMAGE_LIMIT,
    globalLimit = DEFAULT_GLOBAL_LIMIT,
    windowMs = DEFAULT_WINDOW_MS,
    sweepThreshold = DEFAULT_SWEEP_THRESHOLD,
  } = options

  const perImageWindows = new Map<string, RateWindow>()
  let globalWindow: RateWindow = { count: 0, windowStart: now() }

  const sweepExpired = (at: number): void => {
    for (const [key, window] of perImageWindows) {
      if (at - window.windowStart > windowMs) perImageWindows.delete(key)
    }
  }

  const check = (imageHash: string): boolean => {
    const at = now()

    if (at - globalWindow.windowStart > windowMs) {
      globalWindow = { count: 0, windowStart: at }
    }
    // The global budget is read before the per-image one and neither counter
    // moves on a refusal, so a request turned away by one budget does not
    // spend the other.
    if (globalWindow.count >= globalLimit) return false

    let window = perImageWindows.get(imageHash)
    if (!window || at - window.windowStart > windowMs) {
      window = { count: 0, windowStart: at }
      perImageWindows.set(imageHash, window)
    }
    if (window.count >= perImageLimit) return false

    window.count += 1
    globalWindow.count += 1

    if (perImageWindows.size > sweepThreshold) sweepExpired(at)

    return true
  }

  const reset = (): void => {
    perImageWindows.clear()
    globalWindow = { count: 0, windowStart: now() }
  }

  return { check, reset, trackedImages: () => perImageWindows.size }
}
