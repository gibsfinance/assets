/**
 * @module image/concurrency-gate
 * A gate that lets a fixed number of tasks run at once, holds a bounded line of others, and turns
 * the rest away.
 *
 * A plated image is drawn on demand and never stored (see `servePlated` in `resize.ts`), so
 * a caller that varies the colour on every request makes the server draw every time. The request
 * budget limits how often one image may be drawn; this gate limits how much drawing happens at the
 * same moment, so a burst across many images cannot hold every thread and all the memory at once.
 * Turning away is better than an unbounded line: a line that grows without limit is the same memory
 * problem with a delay in front of it.
 */

/** What `run` answers when the gate is busy and its line is full. */
export const GATE_FULL = Symbol('gate-full')

/** The tasks a gate runs at once, when nothing says otherwise. */
export const DEFAULT_GATE_LIMIT = 1

/** How many waiting tasks the line holds for each task that may run at once. */
export const GATE_QUEUE_PER_SLOT = 8

export interface ConcurrencyGate {
  /**
   * Run `task` when a slot is free, waiting in line if all are busy. Answers `GATE_FULL`, and does
   * not run `task`, when every slot is busy and the line is full. With a `key`, also answers
   * `GATE_FULL` when that key already holds `maxPerKey` places (running or waiting), so one caller
   * cannot fill the line for everyone.
   */
  run: <Result>(task: () => Promise<Result>, options?: { key?: string }) => Promise<Result | typeof GATE_FULL>
  /** Tasks running now. */
  readonly active: number
  /** Tasks waiting for a slot. */
  readonly waiting: number
}

/**
 * Build a gate.
 *
 * @param options.limit Tasks that may run at once.
 * @param options.maxQueue Tasks that may wait. Defaults to `GATE_QUEUE_PER_SLOT` for each slot.
 * @param options.maxPerKey Places (running plus waiting) one key may hold. Unlimited when absent.
 */
export function createConcurrencyGate({
  limit = DEFAULT_GATE_LIMIT,
  maxQueue = limit * GATE_QUEUE_PER_SLOT,
  maxPerKey = Infinity,
}: { limit?: number; maxQueue?: number; maxPerKey?: number } = {}): ConcurrencyGate {
  let active = 0
  const placesByKey = new Map<string, number>()
  const line: (() => void)[] = []

  // A finished task hands its slot straight to the next in line, so `active` does not drop and
  // rise again and a newcomer cannot slip in ahead of the line.
  const release = (): void => {
    const next = line.shift()
    if (next) next()
    else active -= 1
  }

  const givePlaceBack = (key: string): void => {
    const remaining = placesByKey.get(key)! - 1
    if (remaining > 0) placesByKey.set(key, remaining)
    else placesByKey.delete(key)
  }

  return {
    async run(task, { key }: { key?: string } = {}) {
      const held = key === undefined ? 0 : (placesByKey.get(key) ?? 0)
      if (held >= maxPerKey) return GATE_FULL
      if (active >= limit && line.length >= maxQueue) return GATE_FULL
      if (key !== undefined) placesByKey.set(key, held + 1)
      if (active < limit) active += 1
      else await new Promise<void>((resolve) => line.push(resolve))
      try {
        return await task()
      } finally {
        release()
        if (key !== undefined) givePlaceBack(key)
      }
    },
    get active() {
      return active
    },
    get waiting() {
      return line.length
    },
  }
}
