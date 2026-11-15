import { describe, it, expect } from 'vitest'
import { createConcurrencyGate, GATE_FULL, DEFAULT_GATE_LIMIT, GATE_QUEUE_PER_SLOT } from './concurrency-gate'

/** A task the test finishes by hand, and a record of when it started. */
function manualTask(log: string[], name: string) {
  let finish = () => {}
  const task = () => {
    log.push(`start ${name}`)
    return new Promise<string>((resolve) => {
      finish = () => resolve(name)
    })
  }
  return { task, finish: () => finish() }
}

describe('createConcurrencyGate', () => {
  it('never runs more tasks at once than its limit, and starts waiting ones in order', async () => {
    const gate = createConcurrencyGate({ limit: 2, maxQueue: 10 })
    const log: string[] = []
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((name) => manualTask(log, name))
    const results = [gate.run(a.task), gate.run(b.task), gate.run(c.task), gate.run(d.task)]
    expect(log).toEqual(['start a', 'start b'])
    expect([gate.active, gate.waiting]).toEqual([2, 2])
    a.finish()
    await results[0]
    expect(log).toEqual(['start a', 'start b', 'start c'])
    // The slot passed straight to the next task: the count did not dip.
    expect([gate.active, gate.waiting]).toEqual([2, 1])
    b.finish()
    c.finish()
    await Promise.all([results[1], results[2]])
    d.finish()
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd'])
    expect([gate.active, gate.waiting]).toEqual([0, 0])
  })

  it('turns a task away, without running it, when every slot is busy and the line is full', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 1 })
    const log: string[] = []
    const running = manualTask(log, 'running')
    const waiting = manualTask(log, 'waiting')
    const refused = manualTask(log, 'refused')
    const first = gate.run(running.task)
    const second = gate.run(waiting.task)
    expect(await gate.run(refused.task)).toBe(GATE_FULL)
    expect(log).toEqual(['start running'])
    running.finish()
    await first
    waiting.finish()
    expect(await second).toBe('waiting')
  })

  it('frees the slot when a task fails, and passes the failure on', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 1 })
    const failing = gate.run(async () => {
      throw new Error('boom')
    })
    const after = gate.run(async () => 'ran')
    await expect(failing).rejects.toThrow('boom')
    expect(await after).toBe('ran')
    expect([gate.active, gate.waiting]).toEqual([0, 0])
  })

  it('defaults to one at a time with eight places in line for it', async () => {
    expect(DEFAULT_GATE_LIMIT).toBe(1)
    const gate = createConcurrencyGate()
    const log: string[] = []
    const holder = manualTask(log, 'holder')
    const held = gate.run(holder.task)
    const line = Array.from({ length: GATE_QUEUE_PER_SLOT }, () => gate.run(async () => 'ok'))
    expect(gate.waiting).toBe(GATE_QUEUE_PER_SLOT)
    expect(await gate.run(async () => 'too many')).toBe(GATE_FULL)
    holder.finish()
    await held
    expect(await Promise.all(line)).toEqual(Array(GATE_QUEUE_PER_SLOT).fill('ok'))
  })

  it('sizes the line by the limit', () => {
    const gate = createConcurrencyGate({ limit: 3 })
    const log: string[] = []
    for (let index = 0; index < 3 + 3 * GATE_QUEUE_PER_SLOT; index += 1) void gate.run(manualTask(log, `${index}`).task)
    expect([gate.active, gate.waiting]).toEqual([3, 3 * GATE_QUEUE_PER_SLOT])
  })

  it('turns a key away once it holds its places, and gives each place back when its task ends', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxQueue: 8, maxPerKey: 2 })
    const log: string[] = []
    const first = manualTask(log, 'first')
    const second = manualTask(log, 'second')
    const held = gate.run(first.task, { key: 'caller' })
    const waiting = gate.run(second.task, { key: 'caller' })
    // Two places held: the line has room, but this caller has used its share.
    expect(await gate.run(async () => 'third', { key: 'caller' })).toBe(GATE_FULL)
    // Another caller, and a task with no key, are not affected.
    const other = gate.run(async () => 'other', { key: 'someone-else' })
    const unkeyed = gate.run(async () => 'unkeyed')
    first.finish()
    await held
    // A place is free again.
    const again = gate.run(async () => 'again', { key: 'caller' })
    second.finish()
    expect(await waiting).toBe('second')
    expect(await Promise.all([other, unkeyed, again])).toEqual(['other', 'unkeyed', 'again'])
    expect([gate.active, gate.waiting]).toEqual([0, 0])
  })

  it('gives a place back when a keyed task throws', async () => {
    const gate = createConcurrencyGate({ limit: 1, maxPerKey: 1 })
    await expect(
      gate.run(
        async () => {
          throw new Error('boom')
        },
        { key: 'caller' },
      ),
    ).rejects.toThrow('boom')
    expect(await gate.run(async () => 'ok', { key: 'caller' })).toBe('ok')
  })
})
