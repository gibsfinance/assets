import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logMock = vi.hoisted(() => vi.fn())
const configMock = vi.hoisted(() => ({
  default: { imageStoreDirectory: '', imageStore: undefined as string | undefined },
}))
vi.mock('../logger', () => ({ log: logMock }))
vi.mock('../../config', () => configMock)

import { getImageStore, hashBytes, initializeImageStore, resetImageStoreForTests } from './index'

let root: string

beforeEach(async () => {
  root = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-store-index-test-'))
  configMock.default.imageStoreDirectory = root
  configMock.default.imageStore = undefined
  logMock.mockClear()
  resetImageStoreForTests()
})

afterEach(async () => {
  resetImageStoreForTests()
  await fileSystem.rm(root, { recursive: true, force: true })
})

describe('getImageStore', () => {
  it('builds one store from the configured directory and reuses it', async () => {
    const first = getImageStore()
    const second = getImageStore()

    expect(second).toBe(first)
    const stored = await first.put(Buffer.from('hello'))
    expect(await fileSystem.readFile(path.join(root, 'sha256', stored.sha256.slice(0, 2), stored.sha256))).toEqual(
      Buffer.from('hello'),
    )
  })

  it('builds a new store after a reset, aimed at whatever directory is configured then', async () => {
    const first = getImageStore()
    const otherRoot = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-store-index-other-'))
    configMock.default.imageStoreDirectory = otherRoot
    resetImageStoreForTests()

    const second = getImageStore()
    const stored = await second.put(Buffer.from('elsewhere'))

    expect(second).not.toBe(first)
    expect(await first.stat(stored.sha256)).toBeNull()
    expect(await second.stat(stored.sha256)).toEqual(expect.objectContaining(stored))
    await fileSystem.rm(otherRoot, { recursive: true, force: true })
  })

  it('sweeps old temporary files when it is first built, and says how many', async () => {
    const stale = path.join(root, 'tmp', 'left-by-a-crash')
    await fileSystem.mkdir(path.dirname(stale), { recursive: true })
    await fileSystem.writeFile(stale, 'partial')
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fileSystem.utimes(stale, twoHoursAgo, twoHoursAgo)

    getImageStore()

    await vi.waitFor(() => expect(logMock).toHaveBeenCalledWith('image store: swept %d stale temporary files', 1))
    await expect(fileSystem.stat(stale)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stays quiet when there is nothing to sweep', async () => {
    getImageStore()
    // Let the background sweep finish: a later write on the same store goes through the same queue of work.
    await getImageStore().stat(hashBytes(Buffer.from('anything')))
    await new Promise((resolve) => setImmediate(resolve))

    expect(logMock).not.toHaveBeenCalled()
  })

  it('logs a failed sweep instead of throwing', async () => {
    // A file where the directory should be makes every read below it fail with something other than "not there".
    const blocker = path.join(root, 'blocker')
    await fileSystem.writeFile(blocker, 'a file, not a directory')
    configMock.default.imageStoreDirectory = blocker

    expect(() => getImageStore()).not.toThrow()

    await vi.waitFor(() =>
      expect(logMock).toHaveBeenCalledWith('image store: temporary file sweep failed: %o', expect.anything()),
    )
  })
})

describe('initializeImageStore', () => {
  it('builds and returns the shared store when the configuration is good', () => {
    const exit = vi.fn()

    expect(initializeImageStore({ exit, report: vi.fn() })).toBe(getImageStore())
    expect(exit).not.toHaveBeenCalled()
  })

  it('reports one clear line and exits with 1 when the configuration is wrong', () => {
    configMock.default.imageStore = 'floppy'
    const report = vi.fn()
    const exit = vi.fn()

    expect(initializeImageStore({ report, exit })).toBeUndefined()

    expect(report).toHaveBeenCalledWith(
      expect.stringMatching(/^image store configuration error: IMAGE_STORE: unknown store type "floppy"/),
    )
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('prints to standard error and ends the process by default', () => {
    configMock.default.imageStore = 'floppy'
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    initializeImageStore()

    expect(error).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
    error.mockRestore()
    exit.mockRestore()
  })

  it('lets a failure that is not a configuration error through', () => {
    configMock.default.imageStore = 'local'
    configMock.default.imageStoreDirectory = null as never

    expect(() => initializeImageStore({ exit: vi.fn(), report: vi.fn() })).toThrow(TypeError)
  })
})

describe('getImageStore with IMAGE_STORE', () => {
  it('builds the kind the setting names', async () => {
    configMock.default.imageStore = JSON.stringify({ type: 'local', dir: root })

    const stored = await getImageStore().put(Buffer.from('named dir'))

    expect(await fileSystem.stat(path.join(root, 'sha256', stored.sha256.slice(0, 2), stored.sha256))).toBeTruthy()
  })
})
