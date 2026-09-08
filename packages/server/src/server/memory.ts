import { log } from '../logger'

/**
 * One memory reading, in megabytes.
 *
 * The names are spelled out deliberately. Node reports `rss`, `heapTotal`, `heapUsed`,
 * `external` and `arrayBuffers`; only the middle three read clearly on their own, and
 * the one that matters most for a bill is the one whose name says least.
 */
export type MemorySample = {
  /** Total memory held by the process, which is what a host meters and charges for. */
  residentSetSize: number
  /** Heap the runtime has claimed from the operating system. */
  heapTotal: number
  /** Heap actually in use by live objects. */
  heapUsed: number
  /** Memory held by the runtime outside the heap, such as native buffers. */
  external: number
  /** The subset of external memory held by array buffers, image bytes included. */
  arrayBuffers: number
}

/** A running peak alongside the latest reading. */
export type MemoryReport = {
  current: MemorySample
  /** The largest reading seen so far, so a spike between reports is not lost. */
  peak: MemorySample
}

const BYTES_PER_MEGABYTE = 1024 * 1024

/**
 * Converts a byte count to megabytes, rounded to one decimal place.
 *
 * @param bytes Raw byte count from the runtime.
 * @returns The same quantity in megabytes.
 */
export function toMegabytes(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MEGABYTE) * 10) / 10
}

/**
 * Converts a raw runtime reading into a sample in megabytes.
 *
 * @param usage A reading as the runtime reports it, in bytes.
 * @returns The same reading in megabytes, under names that say what they hold.
 */
export function toSample(usage: NodeJS.MemoryUsage): MemorySample {
  return {
    residentSetSize: toMegabytes(usage.rss),
    heapTotal: toMegabytes(usage.heapTotal),
    heapUsed: toMegabytes(usage.heapUsed),
    external: toMegabytes(usage.external),
    arrayBuffers: toMegabytes(usage.arrayBuffers),
  }
}

/**
 * Combines two samples by taking the larger of each field.
 *
 * Each field peaks on its own schedule — the heap peaks while a response body is being
 * built, array buffers peak while image bytes are in flight — so carrying the largest
 * whole sample would report the other fields as of one arbitrary moment. Fields are
 * tracked separately and the result is a high-water mark rather than any single reading.
 *
 * @param first One sample.
 * @param second The other sample.
 * @returns A sample holding the larger value of each field.
 */
export function mergePeak(first: MemorySample, second: MemorySample): MemorySample {
  return {
    residentSetSize: Math.max(first.residentSetSize, second.residentSetSize),
    heapTotal: Math.max(first.heapTotal, second.heapTotal),
    heapUsed: Math.max(first.heapUsed, second.heapUsed),
    external: Math.max(first.external, second.external),
    arrayBuffers: Math.max(first.arrayBuffers, second.arrayBuffers),
  }
}

/**
 * Renders a report as one log line.
 *
 * @param report The latest reading and the peak so far.
 * @returns A single line, megabytes throughout.
 */
export function formatReport(report: MemoryReport): string {
  const { current, peak } = report
  return [
    `resident ${current.residentSetSize}MB (peak ${peak.residentSetSize}MB)`,
    `heap ${current.heapUsed}/${current.heapTotal}MB (peak used ${peak.heapUsed}MB)`,
    `external ${current.external}MB (peak ${peak.external}MB)`,
    `array buffers ${current.arrayBuffers}MB (peak ${peak.arrayBuffers}MB)`,
  ].join(', ')
}

/** How often to read memory when the caller does not say. */
export const DEFAULT_MEMORY_INTERVAL_MS = 60_000

export type MemoryReportingOptions = {
  /** How often to take a reading. Defaults to {@link DEFAULT_MEMORY_INTERVAL_MS}. */
  intervalMs?: number
  /** Where a reading comes from. Defaults to the runtime. */
  read?: () => NodeJS.MemoryUsage
  /** Where a report goes. Defaults to the shared logger. */
  report?: (line: string) => void
}

export type MemoryReporting = {
  /** Takes a reading now, folds it into the peak, and reports it. */
  reportNow: () => void
  /** Stops the interval. Reports nothing, so a caller decides what the last line is. */
  stop: () => void
}

/**
 * Starts reporting this process's memory use on an interval.
 *
 * Nothing in this server measured its own memory, so a bill that grows could not be
 * attributed to any particular part of it — the collector, the warm builds and the image
 * cache were all equally plausible and none was measurable. A reading a minute costs one
 * call and answers that question with evidence instead of inference.
 *
 * The timer is unreferenced, so it never holds the process open by itself. That matters
 * most for the collector, which is a batch job and must still exit on its own.
 *
 * @param options Interval, and the seams that let a test drive this without a clock.
 * @returns A handle for forcing a reading and for stopping.
 */
export function startMemoryReporting(options: MemoryReportingOptions = {}): MemoryReporting {
  const { intervalMs = DEFAULT_MEMORY_INTERVAL_MS, read = () => process.memoryUsage(), report = log } = options
  let peak: MemorySample | undefined
  const reportNow = () => {
    const current = toSample(read())
    peak = peak ? mergePeak(peak, current) : current
    report(formatReport({ current, peak }))
  }
  const timer = setInterval(reportNow, intervalMs)
  timer.unref()
  return { reportNow, stop: () => clearInterval(timer) }
}
