/** A clock a test moves by hand, shared between an adapter and the fake service it talks to. */
export type FakeClock = {
  /** The current time in milliseconds since the epoch. */
  now: () => number
  /** Moves the clock forward. */
  advance: (milliseconds: number) => void
}

/**
 * Builds a clock that stands still until it is advanced.
 *
 * @param startMs Where it starts. Defaults to a fixed day in 2026, so dates in tests are stable.
 */
export const createFakeClock = (startMs = Date.UTC(2026, 10, 11, 12, 0, 0)): FakeClock => {
  let current = startMs
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds
    },
  }
}
