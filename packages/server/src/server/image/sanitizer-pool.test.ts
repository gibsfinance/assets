import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { failures } from '@gibs/utils'
import {
  createInProcessSanitizer,
  createSanitizerPool,
  SANITIZE_TIMEOUT_MS,
  SANITIZER_IDLE_MS,
  REMOTE_IMAGE_PLACES,
  SANITIZER_QUEUE_MAX_WAIT_MS,
  type SanitizeAttempt,
} from './sanitizer-pool'

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>')
const fixture = (name: string): URL => new URL(`./__testing__/${name}`, import.meta.url)
const alwaysWanted = (): boolean => true

/** The text of a sanitized attempt; a test fails when the attempt is anything else. */
const sanitizedText = (attempt: SanitizeAttempt): string => {
  if (attempt.status !== 'sanitized') throw new Error(`expected a sanitized file, got ${attempt.status}`)
  return attempt.bytes.toString()
}

// Starting a worker is slow in this environment (up to about three seconds when a worker follows a stopped one), so
// these tests allow longer than the default five seconds. The bounds they assert are the pool's own timers.
describe('createSanitizerPool', { timeout: 30_000 }, () => {
  it('sanitizes a file on a worker thread, removing what the sanitizer removes', async () => {
    const pool = createSanitizerPool()
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(sanitizedText(attempt)).not.toContain('alert')
      expect(pool.workers()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('answers the refusal of a file the sanitizer refuses, and keeps the worker', async () => {
    const pool = createSanitizerPool()
    try {
      const attempt = await pool.run({ bytes: Buffer.from('<svg'), ext: '.svg' }, alwaysWanted)

      expect(attempt).toEqual({ status: 'refused', message: expect.stringContaining('svg rejected') })
      expect(pool.workers()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('reuses an idle worker for the next job rather than starting another', async () => {
    const pool = createSanitizerPool()
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(pool.workersStarted()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('runs jobs one at a time, never with more workers than the pool size', async () => {
    const pool = createSanitizerPool({ size: 2 })
    try {
      const attempts = await Promise.all([0, 1, 2, 3].map(() => pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)))

      expect(attempts.map(sanitizedText).every((text) => !text.includes('alert'))).toBe(true)
      expect(pool.workersPeak()).toBeLessThanOrEqual(2)
    } finally {
      pool.close()
    }
  })

  it('the default pool size is one worker', async () => {
    const pool = createSanitizerPool()
    try {
      await Promise.all([0, 1, 2].map(() => pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)))

      expect(pool.workersPeak()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('stops a worker still running when its budget runs out, and answers cut off', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('silent-sanitize-worker.ts'), budgetMs: 100 })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(attempt).toEqual({ status: 'cut-off' })
      expect(pool.workers()).toBe(0)
    } finally {
      pool.close()
    }
  })

  // Fifth review, finding 1: the budget for sanitizing starts when a worker is granted, not when the request started.
  it('starts the sanitizing budget when a worker is granted, so a wait for a worker is not charged to the file', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('slow-sanitize-worker.ts'), budgetMs: 500 })
    try {
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, alwaysWanted)
      // The file needs 300 ms of sanitizing, which is inside the budget; the wait for the holder is 400 ms.
      const queued = pool.run({ bytes: Buffer.from('MID'), ext: '.svg' }, alwaysWanted)

      expect((await holder).status).toBe('sanitized')
      expect((await queued).status).toBe('sanitized')
    } finally {
      pool.close()
    }
  })

  it('answers expired-in-queue, without running the job, when no request wants it by the time a worker is free', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('slow-sanitize-worker.ts'), budgetMs: 5_000 })
    try {
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, alwaysWanted)
      let wanted = true
      const timer = setTimeout(() => (wanted = false), 50)
      const queued = pool.run({ bytes: SVG, ext: '.svg' }, () => wanted)

      expect(await queued).toEqual({ status: 'expired-in-queue' })
      expect((await holder).status).toBe('sanitized')
      clearTimeout(timer)
    } finally {
      pool.close()
    }
  })

  // Fifth review, finding 3: a stopped worker counts against the pool until it has exited.
  it('never has more workers alive than the pool size, across a cut-off followed by a queued job', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('silent-sanitize-worker.ts'), budgetMs: 100 })
    try {
      const first = pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      const second = pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(await first).toEqual({ status: 'cut-off' })
      expect(await second).toEqual({ status: 'cut-off' })
      expect(pool.workersPeak()).toBe(1)
      expect(pool.workers()).toBe(0)
    } finally {
      pool.close()
    }
  })

  // Fifth review, finding 2: a worker that fails for its own reasons is unavailable, not a charge on the file.
  // The worker had reported ready and was running this file when it threw: the file is charged, so that a crafted
  // file that crashes the worker is not retried on every request.
  it('answers refused, and charges the file, when the worker throws out of a job after it was ready', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('crashing-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(attempt).toEqual({ status: 'refused', message: expect.stringContaining('fixture crash') })
      expect(pool.workers()).toBe(0)
    } finally {
      pool.close()
    }
  })

  it('answers unavailable when the worker cannot load its code', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('failing-import-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(attempt).toEqual({ status: 'unavailable', message: expect.stringContaining('fixture cannot load') })
    } finally {
      pool.close()
    }
  })

  it('answers unavailable when the worker file is missing', async () => {
    const pool = createSanitizerPool({ workerUrl: new URL('file:///nonexistent/sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(attempt.status).toBe('unavailable')
    } finally {
      pool.close()
    }
  })

  it('answers refused when the worker stops by itself while it has a job after it was ready', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('stopping-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(attempt).toEqual({ status: 'refused', message: 'sanitizer worker stopped while running this file' })
      expect(pool.workers()).toBe(0)
    } finally {
      pool.close()
    }
  })

  // The file caused this one: the worker ran out of the heap it was given, so the job is refused and charged.
  it('answers refused when the worker runs out of memory on a job', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('memory-hog-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(attempt).toEqual({ status: 'refused', message: 'sanitizer worker ran out of memory' })
    } finally {
      pool.close()
    }
  })

  it('reports a worker that is unavailable once in the failure log, whatever the number of jobs', async () => {
    const before = failures.length
    const pool = createSanitizerPool({ workerUrl: fixture('failing-import-sanitize-worker.ts') })
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      const reports = failures.slice(before).filter((entry) => String(entry[0]).startsWith('sanitizer unavailable'))
      expect(reports).toHaveLength(1)
    } finally {
      pool.close()
    }
  })

  // Fifth review, finding 4: a closed pool answers unavailable, and a job waiting for a worker does not start one.
  it('answers unavailable, and starts no worker, for a job whose slot was granted before close was called', async () => {
    const pool = createSanitizerPool()
    const job = pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

    pool.close()

    expect(await job).toEqual({ status: 'unavailable', message: 'sanitizer pool closed' })
    expect(pool.workersStarted()).toBe(0)
  })

  it('answers unavailable, not refused, for a job that is running when the pool closes', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('silent-sanitize-worker.ts'), budgetMs: 5_000 })
    const running = pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
    // Long enough for the worker to load and take the job; the silent worker never answers it.
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    pool.close()

    expect(await running).toEqual({ status: 'unavailable', message: 'sanitizer pool closed' })
  })

  it('answers unavailable for a job run after close, and for every job waiting when close is called', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('silent-sanitize-worker.ts'), budgetMs: 5_000 })
    const running = pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
    const waiting = pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
    await vi.waitFor(() => expect(pool.workers()).toBe(1))

    pool.close()

    expect(await waiting).toEqual({ status: 'unavailable', message: 'sanitizer pool closed' })
    expect(await running).toEqual({ status: 'unavailable', message: 'sanitizer pool closed' })
    expect(await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)).toEqual({
      status: 'unavailable',
      message: 'sanitizer pool closed',
    })
    expect(pool.workersStarted()).toBe(1)
    await vi.waitFor(() => expect(pool.workers()).toBe(0))
  })
})

describe('the sanitizer queue is bounded (sixth review, queue)', { timeout: 30_000 }, () => {
  const slowWorker = new URL('./__testing__/slow-sanitize-worker.ts', import.meta.url)

  it('reserves no more places than the queue limit, and a released place can be reserved again', () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker, places: 2 })
    try {
      const first = pool.reserve()
      const second = pool.reserve()
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(pool.reserve()).toBeNull()

      first?.release()

      expect(pool.reserve()).not.toBeNull()
    } finally {
      pool.close()
    }
  })

  it('releases a place once, however often release is called', () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker, places: 1 })
    try {
      const place = pool.reserve()
      place?.release()
      place?.release()

      expect(pool.reserve()).not.toBeNull()
      expect(pool.reserve()).toBeNull()
    } finally {
      pool.close()
    }
  })

  it('sheds a job that waits longer than the maximum wait, and the running job still finishes', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker, queueMaxWaitMs: 100 })
    try {
      const holder = pool.run({ bytes: Buffer.from('HOLD'), ext: '.svg' }, alwaysWanted)
      const waited = await pool.run({ bytes: Buffer.from('MID'), ext: '.svg' }, alwaysWanted)

      expect(waited).toEqual({ status: 'expired-in-queue' })
      expect((await holder).status).toBe('sanitized')
    } finally {
      pool.close()
    }
  })

  it('lets a running job finish when no request wants its file any more', async () => {
    const pool = createSanitizerPool({ workerUrl: slowWorker })
    try {
      let wanted = true
      const running = pool.run({ bytes: Buffer.from('MID'), ext: '.svg' }, () => wanted)
      await new Promise((resolve) => setTimeout(resolve, 50))
      wanted = false

      expect((await running).status).toBe('sanitized')
    } finally {
      pool.close()
    }
  })

  it('the default queue limit is eight, and the default maximum wait five seconds', () => {
    expect(REMOTE_IMAGE_PLACES).toBe(8)
    expect(SANITIZER_QUEUE_MAX_WAIT_MS).toBe(5_000)
  })
})

/**
 * A stand-in worker for the pool's failure paths. It reports ready, takes jobs and never answers them, and when it is
 * stopped it takes two seconds to exit. Its timers are unreferenced, so a test that ends first leaves nothing behind.
 */
class SlowExitWorker extends EventEmitter {
  constructor() {
    super()
    setTimeout(() => this.emit('message', { ready: true }), 0).unref()
  }
  postMessage(): void {
    // Never answered: the budget stops the job.
  }
  unref(): void {
    // Nothing to keep alive.
  }
  terminate(): Promise<number> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.emit('exit', 1)
        resolve(1)
      }, 2_000).unref()
    })
  }
}
const slowExitWorker = (): Worker => new SlowExitWorker() as unknown as Worker

describe(
  'a worker that cannot start, never reports ready, or exits slowly (sixth round, failures)',
  { timeout: 30_000 },
  () => {
    it('answers unavailable, and starts no worker, when the worker cannot be started at all', async () => {
      const pool = createSanitizerPool({
        createWorker: () => {
          throw Object.assign(new Error('invalid exec argv'), { code: 'ERR_WORKER_INVALID_EXEC_ARGV' })
        },
      })
      try {
        expect(await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)).toEqual({
          status: 'unavailable',
          message: 'sanitizer worker could not start: invalid exec argv',
        })
        expect(pool.workersStarted()).toBe(0)
      } finally {
        pool.close()
      }
    })

    it('answers unavailable, and stops the worker, when it never reports ready', async () => {
      const pool = createSanitizerPool({ workerUrl: fixture('silent-ready-sanitize-worker.ts'), readyTimeoutMs: 200 })
      try {
        expect(await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)).toEqual({
          status: 'unavailable',
          message: 'sanitizer worker failed: did not report ready within 200 ms',
        })
        await vi.waitFor(() => expect(pool.workers()).toBe(0))
      } finally {
        pool.close()
      }
    })

    // The slot is given back at the grace, not at the exit: the worker takes two seconds to exit, the grace is 300 ms.
    it('gives the slot back within the grace after a cut-off, even when the worker exits slowly', async () => {
      const pool = createSanitizerPool({ createWorker: slowExitWorker, budgetMs: 100, terminateGraceMs: 300 })
      try {
        const first = performance.now()
        expect(await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)).toEqual({ status: 'cut-off' })
        expect(performance.now() - first).toBeLessThan(1_500)

        const second = performance.now()
        expect(await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)).toEqual({ status: 'cut-off' })
        expect(performance.now() - second).toBeLessThan(1_500)
        expect(pool.workersPeak()).toBe(2)
      } finally {
        pool.close()
      }
    })

    // One stopped worker may still be alive: a second one may start, a third may not.
    it('refuses a third worker while two stopped workers are still alive', async () => {
      const pool = createSanitizerPool({ createWorker: slowExitWorker, budgetMs: 100, terminateGraceMs: 50 })
      try {
        await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
        await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

        expect(await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)).toEqual({
          status: 'unavailable',
          message: 'sanitizer workers are still stopping',
        })
        expect(pool.workersPeak()).toBe(2)
      } finally {
        pool.close()
      }
    })
  },
)

describe('createInProcessSanitizer', () => {
  it('sanitizes with the function it was given, on the calling thread', async () => {
    const sanitize = vi.fn(async (bytes: Buffer) => Buffer.from(`clean:${bytes.toString()}`))
    const runner = createInProcessSanitizer(sanitize)

    const attempt = await runner.run({ bytes: Buffer.from('x'), ext: '.png' }, alwaysWanted)

    expect(attempt).toEqual({ status: 'sanitized', bytes: Buffer.from('clean:x') })
    expect(sanitize).toHaveBeenCalledWith(Buffer.from('x'), '.png')
    expect(runner.workers()).toBe(0)
    expect(runner.workersStarted()).toBe(0)
    expect(runner.workersPeak()).toBe(0)
    runner.close()
  })

  it('lets a sanitizer error reach the caller', async () => {
    const runner = createInProcessSanitizer(async () => {
      throw new Error('refused in process')
    })

    await expect(runner.run({ bytes: Buffer.from('x'), ext: '.png' }, alwaysWanted)).rejects.toThrow(
      'refused in process',
    )
  })

  it('has the named sanitizing budget of five seconds', () => {
    expect(SANITIZE_TIMEOUT_MS).toBe(5_000)
  })
})

/**
 * Timers a test drives by hand. `fire` runs a pending callback; `fireStale` runs one even after it was cleared, the
 * way a timer that was already due when it was cleared would run.
 */
const fakeTimers = () => {
  const scheduled: { callback: () => void; cleared: boolean; fired: boolean }[] = []
  return {
    set: (callback: () => void) => {
      scheduled.push({ callback, cleared: false, fired: false })
      return scheduled.length - 1
    },
    clear: (handle: unknown) => {
      const entry = scheduled[handle as number]
      if (entry) entry.cleared = true
    },
    pending: () => scheduled.filter((entry) => !entry.cleared && !entry.fired).length,
    fire: () => {
      for (const entry of scheduled) {
        if (entry.cleared || entry.fired) continue
        entry.fired = true
        entry.callback()
      }
    },
    fireStale: () => {
      for (const entry of scheduled) entry.callback()
    },
  }
}

describe('an idle worker is stopped after the idle window (fifth review, memory)', { timeout: 30_000 }, () => {
  it('stops a worker that has had no job for the idle window', async () => {
    const timers = fakeTimers()
    const pool = createSanitizerPool({ timers })
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      expect(pool.workers()).toBe(1)
      expect(timers.pending()).toBe(1)

      timers.fire()

      await vi.waitFor(() => expect(pool.workers()).toBe(0))
    } finally {
      pool.close()
    }
  })

  it('uses the named idle window of sixty seconds by default', () => {
    expect(SANITIZER_IDLE_MS).toBe(60_000)
  })

  it('reuses the worker for a job inside the idle window, without starting another', async () => {
    const timers = fakeTimers()
    const pool = createSanitizerPool({ timers })
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(pool.workersStarted()).toBe(1)
      expect(pool.workers()).toBe(1)
      // The window restarts when the job ends: one timer is pending, the one from the first job was cleared.
      expect(timers.pending()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('starts a fresh worker for a job after the idle worker was stopped', async () => {
    const timers = fakeTimers()
    const pool = createSanitizerPool({ timers })
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      timers.fire()
      await vi.waitFor(() => expect(pool.workers()).toBe(0))

      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

      expect(sanitizedText(attempt)).not.toContain('alert')
      expect(pool.workersStarted()).toBe(2)
      expect(pool.workers()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('never stops a worker that is running a job, even when a stale idle timer fires', async () => {
    const timers = fakeTimers()
    const pool = createSanitizerPool({ timers })
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)
      // A file large enough to run for a few hundred milliseconds, so the job is still running below.
      const large = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg">${Array.from({ length: 8_000 }, (_, i) => `<path d="M${i} 0L${i + 1} 1Z"/>`).join('')}</svg>`,
      )
      const running = pool.run({ bytes: large, ext: '.svg' }, alwaysWanted)
      await new Promise((resolve) => setImmediate(resolve))

      timers.fireStale()

      expect(pool.workers()).toBe(1)
      expect(sanitizedText(await running)).toContain('<path')
    } finally {
      pool.close()
    }
  })

  it('stops the idle worker on close, and leaves no timer pending', async () => {
    const timers = fakeTimers()
    const pool = createSanitizerPool({ timers })
    await pool.run({ bytes: SVG, ext: '.svg' }, alwaysWanted)

    pool.close()

    expect(timers.pending()).toBe(0)
    await vi.waitFor(() => expect(pool.workers()).toBe(0))
  })
})
