import { beforeEach, describe, expect, it, vi } from 'vitest'

const parse = vi.fn()
vi.mock('./utils', () => ({ parse: (...args: unknown[]) => parse(...args) }))

describe('exportImage', () => {
  beforeEach(() => {
    vi.resetModules()
    parse.mockReset()
  })

  it('shapes the parsed argv into the export-image config', async () => {
    parse.mockReturnValue({ token: '0xabc', chainId: 369 })
    const { exportImage } = await import('./export-image')

    expect(exportImage()).toEqual({ token: '0xabc', chainId: 369 })
    expect(parse).toHaveBeenCalledWith(
      'export-image',
      expect.objectContaining({ token: expect.any(Object), chainId: expect.any(Object) }),
    )
  })

  it('memoizes so the argv is only parsed once per process', async () => {
    parse.mockReturnValue({ token: undefined, chainId: 1 })
    const { exportImage } = await import('./export-image')

    exportImage()
    exportImage()

    expect(parse).toHaveBeenCalledTimes(1)
  })
})
