import { describe, expect, it, vi } from 'vitest'
import { createFakeClock } from './__testing__/fake-clock'
import { createMemoryObjectClient } from './__testing__/memory-object-client'
import { copyBlobs, MAXIMUM_REPORTED_ERRORS } from './copy'
import { hashBytes } from './hash'
import { createObjectBlobStore, objectKeyOf } from './object-blob-store'
import type { BlobStore } from './types'

vi.mock('../logger', () => ({ log: vi.fn() }))

const build = () => {
  const clock = createFakeClock()
  const sourceClient = createMemoryObjectClient(clock, 2)
  const destinationClient = createMemoryObjectClient(clock, 2)
  return {
    sourceClient,
    destinationClient,
    from: createObjectBlobStore({ client: sourceClient }),
    to: createObjectBlobStore({ client: destinationClient }),
  }
}

const digestOf = (text: string) => hashBytes(Buffer.from(text))

describe('copyBlobs', () => {
  it('copies every blob, checks each against its name, and reports totals', async () => {
    const { from, to } = build()
    for (const text of ['one', 'two', 'three', 'four', 'five']) await from.put(Buffer.from(text))

    const summary = await copyBlobs({ from, to, concurrency: 2 })

    expect(summary).toEqual({
      scanned: 5,
      copied: 5,
      skippedExisting: 0,
      corrupt: 0,
      missing: 0,
      failed: 0,
      bytesCopied: 19,
      errors: [],
      ok: true,
    })
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      expect(await to.get(digestOf(text))).toEqual(Buffer.from(text))
    }
  })

  it('can be stopped and run again: blobs the destination holds are skipped', async () => {
    const { from, to } = build()
    for (const text of ['a', 'b', 'c']) await from.put(Buffer.from(text))
    await to.put(Buffer.from('a'))

    const summary = await copyBlobs({ from, to })

    expect(summary).toMatchObject({ scanned: 3, copied: 2, skippedExisting: 1 })
    expect(await copyBlobs({ from, to })).toMatchObject({ copied: 0, skippedExisting: 3, ok: true })
  })

  it('replaces a destination blob whose length is wrong', async () => {
    const { from, to, destinationClient } = build()
    await from.put(Buffer.from('whole content'))
    destinationClient.objects.set(objectKeyOf(digestOf('whole content')), {
      bytes: Buffer.from('cut'),
      modifiedAtMs: 0,
    })

    const summary = await copyBlobs({ from, to })

    expect(summary.copied).toBe(1)
    expect(await to.get(digestOf('whole content'))).toEqual(Buffer.from('whole content'))
  })

  it('never writes bytes that do not hash to their name, and says so', async () => {
    const { from, to, sourceClient } = build()
    await from.put(Buffer.from('good'))
    const badDigest = digestOf('bad')
    sourceClient.objects.set(objectKeyOf(badDigest), { bytes: Buffer.from('rotted'), modifiedAtMs: 0 })

    const summary = await copyBlobs({ from, to })

    expect(summary).toMatchObject({ scanned: 2, copied: 1, corrupt: 1, ok: false })
    expect(summary.errors).toEqual([`${badDigest}: the bytes do not match the digest`])
    expect(await to.stat(badDigest)).toBeNull()
  })

  it('reports a blob that is listed but cannot be read', async () => {
    const { from, to } = build()
    const { sha256 } = await from.put(Buffer.from('vanishing'))
    const vanishing: BlobStore = { ...from, get: async () => null }

    const summary = await copyBlobs({ from: vanishing, to })

    expect(summary).toMatchObject({ missing: 1, ok: false })
    expect(summary.errors).toEqual([`${sha256}: listed but cannot be read`])
  })

  it('reports a destination that files bytes under another digest', async () => {
    const { from, to } = build()
    await from.put(Buffer.from('misfiled'))
    const misfiling: BlobStore = { ...to, put: async () => ({ sha256: digestOf('other'), byteSize: 1 }) }

    const summary = await copyBlobs({ from, to: misfiling })

    expect(summary).toMatchObject({ failed: 1, copied: 0, ok: false })
    expect(summary.errors[0]).toContain(`stored it under ${digestOf('other')}`)
  })

  it('keeps going after a failed write, reports each failure, and caps the list of messages', async () => {
    const { from, to } = build()
    for (let index = 0; index < MAXIMUM_REPORTED_ERRORS + 3; index += 1) await from.put(Buffer.from(`blob ${index}`))
    const refusing: BlobStore = { ...to, put: async () => Promise.reject(new Error('quota exceeded')) }

    const summary = await copyBlobs({ from, to: refusing })

    expect(summary).toMatchObject({ failed: MAXIMUM_REPORTED_ERRORS + 3, copied: 0, ok: false })
    expect(summary.errors).toHaveLength(MAXIMUM_REPORTED_ERRORS)
    expect(summary.errors[0]).toMatch(/: quota exceeded$/)
  })

  it('reports a failure that is not an Error by its text', async () => {
    const { from, to } = build()
    await from.put(Buffer.from('x'))
    const refusing: BlobStore = { ...to, stat: async () => Promise.reject('plain text') }

    expect((await copyBlobs({ from, to: refusing })).errors[0]).toMatch(/: plain text$/)
  })

  it('copies no more blobs at once than the concurrency allows', async () => {
    const { from, to } = build()
    for (let index = 0; index < 8; index += 1) await from.put(Buffer.from(`blob ${index}`))
    let active = 0
    let peak = 0
    const slow: BlobStore = {
      ...to,
      put: async (bytes) => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return to.put(bytes)
      },
    }

    await copyBlobs({ from, to: slow, concurrency: 3 })

    expect(peak).toBe(3)
  })

  it('reports progress every so many scanned blobs', async () => {
    const { from, to } = build()
    for (const text of ['a', 'b', 'c', 'd', 'e']) await from.put(Buffer.from(text))
    const onProgress = vi.fn()

    await copyBlobs({ from, to, onProgress, progressEvery: 2 })

    expect(onProgress.mock.calls.map(([summary]) => summary.scanned)).toEqual([2, 4])
  })

  it('copies nothing from an empty store', async () => {
    const { from, to } = build()

    expect(await copyBlobs({ from, to })).toMatchObject({ scanned: 0, copied: 0, ok: true })
  })
})
