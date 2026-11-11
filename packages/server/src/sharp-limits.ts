import sharp from 'sharp'
import config from '../config'

/** The bounds applied to sharp. Each field maps to one setting in `config.sharp`. */
export type SharpLimits = {
  /** Pixel cache size, in megabytes. */
  cacheMemoryMegabytes: number
  /** Most operations the cache keeps. */
  cacheItems: number
  /** Threads libvips may use for one image. */
  concurrency: number
}

/** The two sharp functions this module calls, so a test can pass a recording stand-in. */
export type SharpControls = {
  cache: (options: { memory: number; files: number; items: number }) => unknown
  concurrency: (threads: number) => unknown
}

/**
 * Bounds what sharp may hold on to and how many threads it may use.
 *
 * Out of the box sharp keeps up to 50 MB of pixels in a cache, up to 100 open files, and runs
 * one thread per core. A small host pays for all three, and resizing logos gains nothing from
 * them: a logo is rarely resized twice in one run, and never read from the same file twice.
 * Call this once at start-up in every process that loads sharp.
 *
 * @param limits The bounds to apply. Defaults to the `SHARP_*` settings (see `config.ts`).
 * @param controls The sharp module. Defaults to the real one.
 * @returns The limits that were applied.
 */
export function applySharpLimits(limits: SharpLimits = config.sharp, controls: SharpControls = sharp): SharpLimits {
  controls.cache({ memory: limits.cacheMemoryMegabytes, files: 0, items: limits.cacheItems })
  controls.concurrency(limits.concurrency)
  return limits
}
