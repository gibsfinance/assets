/**
 * Tests for limitConcurrency — the bounded async worker pool.
 *
 * Why: callers use this to fan out network/image work without flooding the
 * browser with hundreds of simultaneous requests. The contract that matters is
 * (1) results come back in input order regardless of completion order, and
 * (2) no more than `concurrency` tasks are ever in flight at once. These tests
 * pin both so a refactor that breaks ordering or lets the cap leak fails here.
 */
import { describe, it, expect } from 'vitest'
import { limitConcurrency } from './concurrency'

/** Deferred promise helper so a test can control exactly when a task resolves. */
const defer = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('limitConcurrency', () => {
  it('returns results in input order even when later items finish first', async () => {
    // item 0 resolves slowest, item 2 fastest — output must still be [0,1,2]
    const delays = [30, 20, 10]
    const results = await limitConcurrency([0, 1, 2], 3, (i) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(i * 10), delays[i])),
    )
    expect(results).toEqual([0, 10, 20])
  })

  it('applies fn to every item exactly once', async () => {
    const seen: number[] = []
    const results = await limitConcurrency([1, 2, 3, 4, 5], 2, async (i) => {
      seen.push(i)
      return i * i
    })
    expect(results).toEqual([1, 4, 9, 16, 25])
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never runs more than `concurrency` tasks at once', async () => {
    let active = 0
    let peak = 0
    await limitConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
    })
    expect(peak).toBe(3)
  })

  it('runs strictly sequentially when concurrency is 1', async () => {
    let active = 0
    let peak = 0
    await limitConcurrency([1, 2, 3], 1, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
    })
    expect(peak).toBe(1)
  })

  it('caps worker count at the number of items when concurrency exceeds length', async () => {
    let active = 0
    let peak = 0
    // 2 items but a budget of 10 — only 2 workers should ever spin up
    await limitConcurrency([1, 2], 10, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
    })
    expect(peak).toBe(2)
  })

  it('resolves to an empty array for empty input without invoking fn', async () => {
    let called = false
    const results = await limitConcurrency([], 4, async () => {
      called = true
      return 1
    })
    expect(results).toEqual([])
    expect(called).toBe(false)
  })

  it('propagates a rejection from any task', async () => {
    await expect(
      limitConcurrency([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error('boom')
        return i
      }),
    ).rejects.toThrow('boom')
  })

  it('drains a backlog larger than the worker count', async () => {
    // 8 items through 2 workers — every result still lands in its slot
    const gates = Array.from({ length: 8 }, () => defer<void>())
    const promise = limitConcurrency(Array.from({ length: 8 }, (_, i) => i), 2, async (i) => {
      await gates[i].promise
      return i * 2
    })
    // release in reverse so completion order is the opposite of input order
    for (let i = 7; i >= 0; i--) gates[i].resolve()
    expect(await promise).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
  })
})
