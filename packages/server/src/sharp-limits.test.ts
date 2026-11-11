import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { applySharpLimits } from './sharp-limits'

describe('applySharpLimits', () => {
  it('hands the cache and thread limits to sharp, and always turns the file cache off', () => {
    const controls = { cache: vi.fn(), concurrency: vi.fn() }

    const applied = applySharpLimits({ cacheMemoryMegabytes: 5, cacheItems: 7, concurrency: 2 }, controls)

    expect(controls.cache).toHaveBeenCalledExactlyOnceWith({ memory: 5, files: 0, items: 7 })
    expect(controls.concurrency).toHaveBeenCalledExactlyOnceWith(2)
    expect(applied).toEqual({ cacheMemoryMegabytes: 5, cacheItems: 7, concurrency: 2 })
  })

  it('bounds the real sharp module with the configured defaults', () => {
    applySharpLimits()

    // sharp reports what it now holds: the answer is the proof, not the call.
    expect(sharp.cache()).toMatchObject({ memory: { max: 16 }, files: { max: 0 }, items: { max: 64 } })
    expect(sharp.concurrency()).toBe(1)
  })
})
