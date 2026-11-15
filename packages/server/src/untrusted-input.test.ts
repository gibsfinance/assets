import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { UNTRUSTED_INPUT, isOverPixelCap } from './untrusted-input'
import { palettePngClaiming } from './__testing__/oversized-png'

describe('isOverPixelCap', () => {
  it('recognises the error sharp raises for an input over the cap', async () => {
    const failure = await sharp(palettePngClaiming(16_383), UNTRUSTED_INPUT)
      .toBuffer()
      .catch((error: unknown) => error)

    expect(isOverPixelCap(failure)).toBe(true)
  })

  it('does not mistake another sharp failure, or a value that is not an error, for it', async () => {
    const corrupt = await sharp(Buffer.from('not an image'), UNTRUSTED_INPUT)
      .toBuffer()
      .catch((error: unknown) => error)

    expect(isOverPixelCap(corrupt)).toBe(false)
    expect(isOverPixelCap('Input image exceeds pixel limit')).toBe(false)
    expect(isOverPixelCap(null)).toBe(false)
  })
})
