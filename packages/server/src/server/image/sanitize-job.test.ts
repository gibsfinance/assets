import { describe, it, expect } from 'vitest'
import { copyToOwnBuffer, runSanitizeJob } from './sanitize-job'

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>')

describe('runSanitizeJob', () => {
  it('answers the sanitized bytes of a vector file, with the script removed', async () => {
    const reply = await runSanitizeJob({ bytes: new Uint8Array(SVG), ext: '.svg' })

    expect(reply.ok).toBe(true)
    if (!reply.ok) throw new Error('expected sanitized bytes')
    const text = Buffer.from(reply.bytes).toString()
    expect(text).not.toContain('alert')
    expect(text).toContain('<rect')
  })

  it('answers the refusal, with its message, for a file the sanitizer refuses', async () => {
    const reply = await runSanitizeJob({ bytes: new Uint8Array(Buffer.from('<svg')), ext: '.svg' })

    expect(reply).toEqual({ ok: false, message: expect.stringContaining('svg rejected') })
  })

  it('refuses a raster format it cannot clean', async () => {
    const reply = await runSanitizeJob({ bytes: new Uint8Array(Buffer.from('not an apng')), ext: '.apng' })

    expect(reply).toEqual({ ok: false, message: expect.stringContaining('.apng') })
  })

  it('reads the bytes as they are in the view it was given, not the whole buffer behind it', async () => {
    const backing = Buffer.concat([Buffer.from('junk-before'), SVG, Buffer.from('junk-after')])
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 'junk-before'.length, SVG.length)

    const reply = await runSanitizeJob({ bytes: view, ext: '.svg' })

    expect(reply.ok).toBe(true)
    if (!reply.ok) throw new Error('expected sanitized bytes')
    expect(Buffer.from(reply.bytes).toString()).toContain('<rect')
  })

  it('answers bytes in a buffer of their own, so transferring them moves nothing else', async () => {
    const reply = await runSanitizeJob({ bytes: new Uint8Array(SVG), ext: '.svg' })

    if (!reply.ok) throw new Error('expected sanitized bytes')
    expect(reply.bytes.byteOffset).toBe(0)
    expect(reply.bytes.buffer.byteLength).toBe(reply.bytes.byteLength)
  })
})

describe('copyToOwnBuffer', () => {
  it('copies the bytes of a view into a buffer of its own', () => {
    const backing = new Uint8Array([9, 1, 2, 3, 9])
    const view = backing.subarray(1, 4)

    const copy = copyToOwnBuffer(view)

    expect(Array.from(copy)).toEqual([1, 2, 3])
    expect(copy.buffer).not.toBe(backing.buffer)
    expect(copy.byteOffset).toBe(0)
  })
})
