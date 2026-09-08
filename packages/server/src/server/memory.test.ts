import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MEMORY_INTERVAL_MS,
  formatReport,
  mergePeak,
  startMemoryReporting,
  toMegabytes,
  toSample,
  type MemorySample,
} from './memory'

const MEGABYTE = 1024 * 1024

/** A reading as the runtime hands it over, in bytes. */
const usage = (megabytes: Partial<Record<keyof NodeJS.MemoryUsage, number>>): NodeJS.MemoryUsage => ({
  rss: (megabytes.rss ?? 0) * MEGABYTE,
  heapTotal: (megabytes.heapTotal ?? 0) * MEGABYTE,
  heapUsed: (megabytes.heapUsed ?? 0) * MEGABYTE,
  external: (megabytes.external ?? 0) * MEGABYTE,
  arrayBuffers: (megabytes.arrayBuffers ?? 0) * MEGABYTE,
})

const sample = (values: Partial<MemorySample>): MemorySample => ({
  residentSetSize: 0,
  heapTotal: 0,
  heapUsed: 0,
  external: 0,
  arrayBuffers: 0,
  ...values,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toMegabytes', () => {
  it('converts against 1024, not 1000, so the number matches what a host reports', () => {
    // A megabyte here has to mean the same thing it means on the bill. Dividing by
    // 1_000_000 would read about five percent low across the board, which is exactly the
    // size of the discrepancies this instrumentation exists to spot.
    expect(toMegabytes(1024 * 1024)).toBe(1)
    expect(toMegabytes(512 * 1024 * 1024)).toBe(512)
  })

  it('keeps one decimal place so small readings do not all collapse to zero', () => {
    expect(toMegabytes(1536 * 1024)).toBe(1.5)
    expect(toMegabytes(100 * 1024)).toBe(0.1)
  })
})

describe('toSample', () => {
  it('maps every field the runtime reports, converted to megabytes', () => {
    const result = toSample(usage({ rss: 300, heapTotal: 200, heapUsed: 150, external: 40, arrayBuffers: 25 }))

    // Dropping a field would leave a whole category of growth invisible: array buffers
    // are where the image bytes live, and they are outside the heap.
    expect(result).toEqual({
      residentSetSize: 300,
      heapTotal: 200,
      heapUsed: 150,
      external: 40,
      arrayBuffers: 25,
    })
  })
})

describe('mergePeak', () => {
  it('takes the larger of each field independently rather than the larger whole sample', () => {
    const earlier = sample({ residentSetSize: 500, heapUsed: 100, arrayBuffers: 200 })
    const later = sample({ residentSetSize: 300, heapUsed: 400, arrayBuffers: 50 })

    const peak = mergePeak(earlier, later)

    // The heap peaks while a response body is built and array buffers peak while image
    // bytes are in flight — different moments. Carrying whichever whole sample looked
    // biggest would report the other fields as of one arbitrary instant and understate
    // the real high-water mark.
    expect(peak.residentSetSize).toBe(500)
    expect(peak.heapUsed).toBe(400)
    expect(peak.arrayBuffers).toBe(200)
  })
})

describe('formatReport', () => {
  it('reports the current reading and the peak together, in megabytes', () => {
    const line = formatReport({
      current: sample({ residentSetSize: 300, heapTotal: 200, heapUsed: 150, external: 40, arrayBuffers: 25 }),
      peak: sample({ residentSetSize: 700, heapTotal: 400, heapUsed: 380, external: 90, arrayBuffers: 75 }),
    })

    // A current reading alone cannot answer the billing question, because the reading
    // that costs money is the spike between two of them.
    expect(line).toContain('resident 300MB (peak 700MB)')
    expect(line).toContain('heap 150/200MB (peak used 380MB)')
    expect(line).toContain('external 40MB (peak 90MB)')
    expect(line).toContain('array buffers 25MB (peak 75MB)')
  })
})

describe('startMemoryReporting', () => {
  it('reports nothing until the first interval elapses', () => {
    vi.useFakeTimers()
    const report = vi.fn()

    const { stop } = startMemoryReporting({ intervalMs: 1_000, read: () => usage({ rss: 100 }), report })

    expect(report).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(report).toHaveBeenCalledTimes(1)
    stop()
  })

  it('carries the peak forward once the reading falls back down', () => {
    vi.useFakeTimers()
    const report = vi.fn()
    const readings = [usage({ rss: 200 }), usage({ rss: 900 }), usage({ rss: 250 })]
    let index = 0

    const { stop } = startMemoryReporting({ intervalMs: 1_000, read: () => readings[index++]!, report })

    vi.advanceTimersByTime(3_000)

    // The whole point of tracking a peak is the third line: memory came back down, and
    // without the carry the spike that was actually billed would leave no trace at all.
    expect(report).toHaveBeenNthCalledWith(1, expect.stringContaining('resident 200MB (peak 200MB)'))
    expect(report).toHaveBeenNthCalledWith(2, expect.stringContaining('resident 900MB (peak 900MB)'))
    expect(report).toHaveBeenNthCalledWith(3, expect.stringContaining('resident 250MB (peak 900MB)'))
    stop()
  })

  it('reports on demand, folding that reading into the same peak', () => {
    vi.useFakeTimers()
    const report = vi.fn()
    const readings = [usage({ rss: 900 }), usage({ rss: 100 })]
    let index = 0

    const { reportNow, stop } = startMemoryReporting({ intervalMs: 1_000, read: () => readings[index++]!, report })
    vi.advanceTimersByTime(1_000)
    stop()
    reportNow()

    // A batch job — the collector — exits between ticks, so without an on-demand reading
    // its final stretch is never reported. The peak has to survive that call, or the
    // closing line would claim the run peaked at whatever it happened to end on.
    expect(report).toHaveBeenNthCalledWith(2, expect.stringContaining('resident 100MB (peak 900MB)'))
  })

  it('stops reporting once the returned function is called', () => {
    vi.useFakeTimers()
    const report = vi.fn()

    const { stop } = startMemoryReporting({ intervalMs: 1_000, read: () => usage({ rss: 100 }), report })
    vi.advanceTimersByTime(1_000)
    stop()
    vi.advanceTimersByTime(5_000)

    // A reporter that outlives its caller would keep a test's clock and a shutdown
    // sequence busy forever.
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('never holds the process open by itself', () => {
    vi.useFakeTimers()
    const unref = vi.fn()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as never)

    const { stop } = startMemoryReporting({ intervalMs: 1_000, read: () => usage({ rss: 1 }), report: vi.fn() })

    // Instrumentation must not be the reason a process refuses to exit — the timer is
    // unreferenced so it reports for as long as the server runs and not one tick longer.
    expect(unref).toHaveBeenCalledTimes(1)
    setIntervalSpy.mockRestore()
    stop()
  })

  it('falls back to the runtime and the shared logger when given no options at all', () => {
    vi.useFakeTimers()

    const { stop } = startMemoryReporting()
    // The defaults are what production actually runs, so they are exercised rather than
    // assumed: this advances a real interval through `process.memoryUsage` and `log`.
    expect(() => vi.advanceTimersByTime(DEFAULT_MEMORY_INTERVAL_MS)).not.toThrow()

    stop()
  })
})
