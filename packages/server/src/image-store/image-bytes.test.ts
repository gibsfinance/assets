import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryBlobStore } from './__testing__/memory-store'
import { loadImageBytes, withImageBytes } from './image-bytes'

const failureLog = vi.hoisted(() => vi.fn())
vi.mock('@gibs/utils', () => ({ failureLog }))
const sharedStore = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./index', () => ({ getImageStore: () => sharedStore }))

const bytes = Buffer.from('the picture')

beforeEach(() => {
  failureLog.mockClear()
  sharedStore.get.mockReset()
})

describe('loadImageBytes', () => {
  it('returns the bytes a row carries itself, without touching the store', async () => {
    const store = createMemoryBlobStore()
    const get = vi.spyOn(store, 'get')

    const loaded = await loadImageBytes({ imageHash: 'h', content: bytes, contentSha256: null }, store)

    expect(loaded).toBe(bytes)
    expect(get).not.toHaveBeenCalled()
  })

  it('returns empty bytes as they are: a link-only row carries an empty buffer, which is not missing', async () => {
    const empty = Buffer.alloc(0)

    expect(await loadImageBytes({ imageHash: 'h', content: empty, contentSha256: null }, createMemoryBlobStore())).toBe(
      empty,
    )
  })

  it('reads the file when the row carries no bytes and has a digest', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(bytes)

    expect(await loadImageBytes({ imageHash: 'h', content: null, contentSha256: sha256 }, store)).toEqual(bytes)
  })

  it('prefers the bytes in the row to the file when both exist', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(Buffer.from('from the file'))

    expect(await loadImageBytes({ imageHash: 'h', content: bytes, contentSha256: sha256 }, store)).toBe(bytes)
  })

  it('answers null for a row with neither bytes nor a digest', async () => {
    expect(
      await loadImageBytes({ imageHash: 'h', content: null, contentSha256: null }, createMemoryBlobStore()),
    ).toBeNull()
  })

  it('answers null and logs which image and file when the file is missing', async () => {
    const missing = 'a'.repeat(64)

    const loaded = await loadImageBytes(
      { imageHash: 'image-1', content: null, contentSha256: missing },
      createMemoryBlobStore(),
    )

    expect(loaded).toBeNull()
    expect(failureLog).toHaveBeenCalledTimes(1)
    expect(failureLog.mock.calls[0]).toContain('image-1')
    expect(failureLog.mock.calls[0]).toContain(missing)
  })

  it('does not hide a failure to read the store', async () => {
    const store = createMemoryBlobStore()
    store.get = async () => {
      throw new Error('input/output error')
    }

    await expect(
      loadImageBytes({ imageHash: 'h', content: null, contentSha256: 'b'.repeat(64) }, store),
    ).rejects.toThrow('input/output error')
    expect(failureLog).not.toHaveBeenCalled()
  })

  it('reads the process store when none is passed', async () => {
    sharedStore.get.mockResolvedValue(bytes)

    expect(await loadImageBytes({ imageHash: 'h', content: null, contentSha256: 'c'.repeat(64) })).toBe(bytes)
    expect(sharedStore.get).toHaveBeenCalledWith('c'.repeat(64))
  })
})

describe('withImageBytes', () => {
  it('returns a copy of the row, with every other column intact and the bytes filled in', async () => {
    const store = createMemoryBlobStore()
    const { sha256 } = await store.put(bytes)
    const row = { imageHash: 'h', content: null, contentSha256: sha256, ext: '.png', uri: 'https://x/a.png' }

    const filled = await withImageBytes(row, store)

    expect(filled).toEqual({ ...row, content: bytes })
    expect(filled).not.toBe(row)
    expect(row.content).toBeNull()
  })
})
