import { beforeEach, describe, expect, it, vi } from 'vitest'

const parse = vi.fn()
vi.mock('./utils', () => ({ parse: (...args: unknown[]) => parse(...args) }))

describe('harvest', () => {
  beforeEach(() => {
    vi.resetModules()
    parse.mockReset()
  })

  it('shapes the parsed argv into the harvest config', async () => {
    parse.mockReturnValue({ coingeckoApiKey: 'test-api-key' })
    const { harvest } = await import('./harvest')

    expect(harvest()).toEqual({ coingeckoApiKey: 'test-api-key' })
    expect(parse).toHaveBeenCalledWith('harvest', expect.objectContaining({ coingeckoApiKey: expect.any(Object) }))
  })

  it('memoizes so the argv is only parsed once per process', async () => {
    parse.mockReturnValue({ coingeckoApiKey: 'test-api-key' })
    const { harvest } = await import('./harvest')

    harvest()
    harvest()
    harvest()

    // yargs re-parsing on every call would be wasted work and, worse, could
    // pick up a mutated process.argv mid-run and silently change config.
    expect(parse).toHaveBeenCalledTimes(1)
  })
})
