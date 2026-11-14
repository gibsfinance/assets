import { describe, it, expect, vi } from 'vitest'
import { createInProcessSanitizer, createSanitizerPool, type SanitizeAttempt } from './sanitizer-pool'

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>')
const fixture = (name: string): URL => new URL(`./__testing__/${name}`, import.meta.url)

/** The text of a sanitized attempt; a test fails when the attempt is anything else. */
const sanitizedText = (attempt: SanitizeAttempt): string => {
  if (attempt.status !== 'sanitized') throw new Error(`expected a sanitized file, got ${attempt.status}`)
  return attempt.bytes.toString()
}

describe('createSanitizerPool', () => {
  it('sanitizes a file on a worker thread, removing what the sanitizer removes', async () => {
    const pool = createSanitizerPool()
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))

      expect(sanitizedText(attempt)).not.toContain('alert')
      expect(pool.workers()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('answers the refusal of a file the sanitizer refuses, and keeps the worker', async () => {
    const pool = createSanitizerPool()
    try {
      const attempt = await pool.run({ bytes: Buffer.from('<svg'), ext: '.svg' }, AbortSignal.timeout(10_000))

      expect(attempt).toEqual({ status: 'refused', message: expect.stringContaining('svg rejected') })
      expect(pool.workers()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('reuses an idle worker for the next job rather than starting another', async () => {
    const pool = createSanitizerPool()
    try {
      await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))
      await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))

      expect(pool.workers()).toBe(1)
    } finally {
      pool.close()
    }
  })

  it('runs several jobs at once without starting more workers than the pool size', async () => {
    const pool = createSanitizerPool({ size: 2 })
    try {
      const attempts = await Promise.all(
        [0, 1, 2, 3].map(() => pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))),
      )

      expect(attempts.map(sanitizedText).every((text) => !text.includes('alert'))).toBe(true)
      expect(pool.workers()).toBeLessThanOrEqual(2)
    } finally {
      pool.close()
    }
  })

  it('stops a worker that is still running when the deadline passes, and answers cut off', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('silent-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(100))

      expect(attempt).toEqual({ status: 'cut-off' })
      await vi.waitFor(() => expect(pool.workers()).toBe(0))
    } finally {
      pool.close()
    }
  })

  it('answers expired-in-queue, without running the job, when the deadline passes while it waits for a worker', async () => {
    const pool = createSanitizerPool({ size: 1, workerUrl: fixture('silent-sanitize-worker.ts') })
    try {
      const holder = pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(150))
      const waiting = pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(30))

      expect(await holder).toEqual({ status: 'cut-off' })
      expect(await waiting).toEqual({ status: 'expired-in-queue' })
      await vi.waitFor(() => expect(pool.workers()).toBe(0))
    } finally {
      pool.close()
    }
  })

  it('answers a refusal, not a hang, when the worker throws out of a job', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('crashing-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))

      expect(attempt).toEqual({ status: 'refused', message: expect.stringContaining('fixture crash') })
      await vi.waitFor(() => expect(pool.workers()).toBe(0))
    } finally {
      pool.close()
    }
  })

  it('answers a refusal when the worker stops while it has a job', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('stopping-sanitize-worker.ts') })
    try {
      const attempt = await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))

      expect(attempt).toEqual({ status: 'refused', message: 'sanitizer worker stopped' })
      expect(pool.workers()).toBe(0)
    } finally {
      pool.close()
    }
  })

  it('forgets an idle worker that stops, so the next job starts a fresh one', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('exits-after-reply-sanitize-worker.ts') })
    try {
      const first = await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))
      expect(first).toEqual({ status: 'refused', message: 'refused by the fixture' })
      await vi.waitFor(() => expect(pool.workers()).toBe(0))

      const second = await pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))
      expect(second).toEqual({ status: 'refused', message: 'refused by the fixture' })
    } finally {
      pool.close()
    }
  })

  it('stops every worker on close', async () => {
    const pool = createSanitizerPool({ workerUrl: fixture('silent-sanitize-worker.ts') })
    const running = pool.run({ bytes: SVG, ext: '.svg' }, AbortSignal.timeout(10_000))
    await vi.waitFor(() => expect(pool.workers()).toBe(1))

    pool.close()

    expect(await running).toEqual({ status: 'refused', message: 'sanitizer worker stopped' })
    await vi.waitFor(() => expect(pool.workers()).toBe(0))
  })
})

describe('createInProcessSanitizer', () => {
  it('sanitizes with the function it was given, on the calling thread', async () => {
    const sanitize = vi.fn(async (bytes: Buffer) => Buffer.from(`clean:${bytes.toString()}`))
    const runner = createInProcessSanitizer(sanitize)

    const attempt = await runner.run({ bytes: Buffer.from('x'), ext: '.png' }, AbortSignal.timeout(10_000))

    expect(attempt).toEqual({ status: 'sanitized', bytes: Buffer.from('clean:x') })
    expect(sanitize).toHaveBeenCalledWith(Buffer.from('x'), '.png')
    expect(runner.workers()).toBe(0)
    runner.close()
  })

  it('lets a sanitizer error reach the caller', async () => {
    const runner = createInProcessSanitizer(async () => {
      throw new Error('refused in process')
    })

    await expect(runner.run({ bytes: Buffer.from('x'), ext: '.png' }, AbortSignal.timeout(10_000))).rejects.toThrow(
      'refused in process',
    )
  })
})
