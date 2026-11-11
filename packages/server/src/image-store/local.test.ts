import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashBytes } from './hash'
import { createLocalBlobStore, STALE_TEMPORARY_FILE_MS, type StoreFileSystem } from './local'

const logMock = vi.hoisted(() => vi.fn())
vi.mock('../logger', () => ({ log: logMock }))

/** The well-known digest of the ASCII text "hello". */
const HELLO_DIGEST = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

const hello = Buffer.from('hello')

let root: string

beforeEach(async () => {
  root = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'image-store-test-'))
  logMock.mockClear()
})

afterEach(async () => {
  await fileSystem.rm(root, { recursive: true, force: true })
})

/** The real file system with some operations replaced. */
const withFaults = (overrides: Partial<StoreFileSystem>): StoreFileSystem => ({ ...fileSystem, ...overrides })

/** An error that carries a system error code, as the file system's own errors do. */
const systemError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

const blobFile = (digest: string) => path.join(root, 'sha256', digest.slice(0, 2), digest)

const temporaryFiles = async () => fileSystem.readdir(path.join(root, 'tmp')).catch(() => [] as string[])

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}

describe('put', () => {
  it('writes new content under its digest, in a shard named for the first two characters', async () => {
    const store = createLocalBlobStore({ root })

    const result = await store.put(hello)

    expect(result).toEqual({ sha256: HELLO_DIGEST, byteSize: 5 })
    expect(blobFile(HELLO_DIGEST)).toBe(path.join(root, 'sha256', '2c', HELLO_DIGEST))
    expect(await fileSystem.readFile(blobFile(HELLO_DIGEST))).toEqual(hello)
    expect(await temporaryFiles()).toEqual([])
  })

  it('writes to a temporary file named for the digest, the process and a random part, then renames it', async () => {
    const opened: string[] = []
    const renamed: [string, string][] = []
    const store = createLocalBlobStore({
      root,
      processId: 4242,
      randomSuffix: () => 'cafe',
      fileSystem: withFaults({
        open: (async (filePath: string, flags: string) => {
          opened.push(`${flags}:${filePath}`)
          return fileSystem.open(filePath, flags)
        }) as StoreFileSystem['open'],
        rename: async (from, to) => {
          renamed.push([String(from), String(to)])
          return fileSystem.rename(from, to)
        },
      }),
    })

    await store.put(hello)

    const temporaryPath = path.join(root, 'tmp', `${HELLO_DIGEST}.4242.cafe`)
    expect(opened).toContain(`wx:${temporaryPath}`)
    expect(renamed).toEqual([[temporaryPath, blobFile(HELLO_DIGEST)]])
    // The shard directory is opened for reading afterwards so its entry can be flushed.
    expect(opened).toContain(`r:${path.dirname(blobFile(HELLO_DIGEST))}`)
  })

  it('uses a real process id and a random part by default', async () => {
    const opened: string[] = []
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        open: (async (filePath: string, flags: string) => {
          opened.push(`${flags}:${path.basename(filePath)}`)
          return fileSystem.open(filePath, flags)
        }) as StoreFileSystem['open'],
      }),
    })

    await store.put(hello)

    expect(opened[0]).toMatch(new RegExp(`^wx:${HELLO_DIGEST}\\.${process.pid}\\.[0-9a-f]{16}$`))
  })

  it('writes nothing the second time the same content arrives', async () => {
    let writes = 0
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        open: (async (filePath: string, flags: string) => {
          if (flags === 'wx') writes += 1
          return fileSystem.open(filePath, flags)
        }) as StoreFileSystem['open'],
      }),
    })
    await store.put(hello)
    const modifiedBefore = (await fileSystem.stat(blobFile(HELLO_DIGEST))).mtimeMs

    const second = await store.put(Buffer.from('hello'))

    expect(second).toEqual({ sha256: HELLO_DIGEST, byteSize: 5 })
    expect(writes).toBe(1)
    expect((await fileSystem.stat(blobFile(HELLO_DIGEST))).mtimeMs).toBe(modifiedBefore)
  })

  it('replaces a file of the right name but the wrong size, which a crashed write elsewhere could leave', async () => {
    await fileSystem.mkdir(path.dirname(blobFile(HELLO_DIGEST)), { recursive: true })
    await fileSystem.writeFile(blobFile(HELLO_DIGEST), 'hel')
    const store = createLocalBlobStore({ root })

    await store.put(hello)

    expect(await fileSystem.readFile(blobFile(HELLO_DIGEST))).toEqual(hello)
  })

  it('stores empty content', async () => {
    const store = createLocalBlobStore({ root })

    const result = await store.put(new Uint8Array())

    expect(result).toEqual({ sha256: hashBytes(new Uint8Array()), byteSize: 0 })
    expect(await store.get(result.sha256)).toEqual(Buffer.alloc(0))
  })

  it('keeps one intact blob and no temporary files when the same content is written at the same time', async () => {
    const store = createLocalBlobStore({ root })

    const results = await Promise.all(Array.from({ length: 12 }, () => store.put(hello)))

    expect(new Set(results.map((result) => result.sha256))).toEqual(new Set([HELLO_DIGEST]))
    expect(await fileSystem.readFile(blobFile(HELLO_DIGEST))).toEqual(hello)
    expect(await temporaryFiles()).toEqual([])
    expect(await collect(store.list())).toEqual([{ sha256: HELLO_DIGEST, byteSize: 5 }])
  })

  it('leaves no temporary file and no blob when the write fails, and closes the file', async () => {
    const close = vi.fn(async () => undefined)
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        open: (async (filePath: string, flags: string) => {
          const real = await fileSystem.open(filePath, flags)
          return {
            writeFile: async () => {
              throw systemError('ENOSPC')
            },
            sync: async () => undefined,
            close: async () => {
              await real.close()
              await close()
            },
          }
        }) as unknown as StoreFileSystem['open'],
      }),
    })

    await expect(store.put(hello)).rejects.toMatchObject({ code: 'ENOSPC' })

    expect(close).toHaveBeenCalledTimes(1)
    expect(await temporaryFiles()).toEqual([])
    await expect(fileSystem.stat(blobFile(HELLO_DIGEST))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves no temporary file and no blob when the rename fails', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        rename: async () => {
          throw systemError('EXDEV')
        },
      }),
    })

    await expect(store.put(hello)).rejects.toMatchObject({ code: 'EXDEV' })

    expect(await temporaryFiles()).toEqual([])
    expect(await store.stat(HELLO_DIGEST)).toBeNull()
  })

  it('reports the original failure even when removing the temporary file fails too', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        rename: async () => {
          throw systemError('EXDEV')
        },
        unlink: async () => {
          throw systemError('EACCES')
        },
      }),
    })

    await expect(store.put(hello)).rejects.toMatchObject({ code: 'EXDEV' })
  })

  it('closes the directory handle even when flushing the directory fails', async () => {
    const close = vi.fn(async () => undefined)
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        open: (async (filePath: string, flags: string) => {
          if (flags !== 'r') return fileSystem.open(filePath, flags)
          return {
            sync: async () => {
              throw systemError('EIO')
            },
            close,
          }
        }) as unknown as StoreFileSystem['open'],
      }),
    })

    await expect(store.put(hello)).rejects.toMatchObject({ code: 'EIO' })

    expect(close).toHaveBeenCalledTimes(1)
  })

  it('passes on a failure to look at the existing file other than "not there"', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        stat: async () => {
          throw systemError('EACCES')
        },
      }),
    })

    await expect(store.put(hello)).rejects.toMatchObject({ code: 'EACCES' })
  })
})

describe('get and stat', () => {
  it('reads back what was stored', async () => {
    const store = createLocalBlobStore({ root })
    await store.put(hello)

    expect(await store.get(HELLO_DIGEST)).toEqual(hello)
    expect(await store.stat(HELLO_DIGEST)).toEqual({ sha256: HELLO_DIGEST, byteSize: 5 })
  })

  it('answers null for a blob that is not there, before and after the store has any files', async () => {
    const store = createLocalBlobStore({ root })
    const absent = hashBytes(Buffer.from('absent'))

    expect(await store.get(absent)).toBeNull()
    expect(await store.stat(absent)).toBeNull()
    await store.put(hello)
    expect(await store.get(absent)).toBeNull()
    expect(await store.stat(absent)).toBeNull()
  })

  it('passes on a read failure other than "not there"', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        readFile: async () => {
          throw systemError('EIO')
        },
      }),
    })

    await expect(store.get(HELLO_DIGEST)).rejects.toMatchObject({ code: 'EIO' })
  })

  it('passes on a thrown value that is not an error object', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        readFile: async () => {
          throw undefined
        },
      }),
    })

    await expect(store.get(HELLO_DIGEST)).rejects.toBeUndefined()
  })
})

describe('delete', () => {
  it('removes a blob once, and says so only the first time', async () => {
    const store = createLocalBlobStore({ root })
    await store.put(hello)

    expect(await store.delete(HELLO_DIGEST)).toBe(true)
    expect(await store.get(HELLO_DIGEST)).toBeNull()
    expect(await store.delete(HELLO_DIGEST)).toBe(false)
  })

  it('passes on a failure other than "not there"', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        unlink: async () => {
          throw systemError('EPERM')
        },
      }),
    })

    await expect(store.delete(HELLO_DIGEST)).rejects.toMatchObject({ code: 'EPERM' })
  })
})

describe('digests that are not digests', () => {
  const refused = [
    '',
    '../../etc/passwd',
    `../${HELLO_DIGEST}`,
    `${HELLO_DIGEST}/../${HELLO_DIGEST}`,
    HELLO_DIGEST.toUpperCase(),
    HELLO_DIGEST.slice(1),
    `${HELLO_DIGEST}0`,
    `${HELLO_DIGEST.slice(0, 63)}g`,
    `${HELLO_DIGEST}\n`,
  ]

  it.each(refused)('refuses %j before it builds a path', async (candidate) => {
    const stat = vi.fn(fileSystem.stat)
    const readFile = vi.fn(fileSystem.readFile)
    const unlink = vi.fn(fileSystem.unlink)
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        stat: stat as StoreFileSystem['stat'],
        readFile: readFile as StoreFileSystem['readFile'],
        unlink,
      }),
    })

    await expect(store.get(candidate)).rejects.toBeInstanceOf(TypeError)
    await expect(store.stat(candidate)).rejects.toBeInstanceOf(TypeError)
    await expect(store.delete(candidate)).rejects.toBeInstanceOf(TypeError)
    expect(stat).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('cannot reach a file outside the store by naming it', async () => {
    const outside = path.join(root, 'outside-secret')
    await fileSystem.writeFile(outside, 'secret')
    const store = createLocalBlobStore({ root: path.join(root, 'store') })

    await expect(store.get('../../outside-secret')).rejects.toBeInstanceOf(TypeError)
    await expect(store.delete('../../outside-secret')).rejects.toBeInstanceOf(TypeError)
    expect(await fileSystem.readFile(outside, 'utf8')).toBe('secret')
  })
})

describe('list', () => {
  it('finds every blob across shards, with its size', async () => {
    const store = createLocalBlobStore({ root })
    const stored = await Promise.all(
      Array.from({ length: 24 }, (_, index) => store.put(Buffer.from(`blob number ${index}`.repeat(index + 1)))),
    )
    const shards = new Set(stored.map((blob) => blob.sha256.slice(0, 2)))
    expect(shards.size).toBeGreaterThan(1)

    const listed = await collect(store.list())

    expect(listed.sort((a, b) => a.sha256.localeCompare(b.sha256))).toEqual(
      [...stored].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    )
  })

  it('yields nothing for a store that has never been written to', async () => {
    const store = createLocalBlobStore({ root: path.join(root, 'never-created') })

    expect(await collect(store.list())).toEqual([])
  })

  it('leaves out files that are not blobs: stray names, wrong shards, directories that are not shards', async () => {
    const store = createLocalBlobStore({ root })
    await store.put(hello)
    const blobs = path.join(root, 'sha256')
    await fileSystem.mkdir(path.join(blobs, '2c'), { recursive: true })
    await fileSystem.writeFile(path.join(blobs, '2c', 'notes.txt'), 'x')
    // A real digest, filed under a shard that is not its own.
    const misplaced = hashBytes(Buffer.from('misplaced'))
    await fileSystem.mkdir(path.join(blobs, '00'), { recursive: true })
    await fileSystem.writeFile(path.join(blobs, '00', misplaced), 'x')
    await fileSystem.mkdir(path.join(blobs, 'zz'), { recursive: true })
    await fileSystem.writeFile(path.join(blobs, 'zz', HELLO_DIGEST), 'x')

    expect(await collect(store.list())).toEqual([{ sha256: HELLO_DIGEST, byteSize: 5 }])
  })

  it('skips a blob that is deleted between being listed and being examined', async () => {
    const writer = createLocalBlobStore({ root })
    await writer.put(hello)
    const other = await writer.put(Buffer.from('other'))
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        stat: (async (filePath: string) => {
          if (filePath.endsWith(HELLO_DIGEST)) throw systemError('ENOENT')
          return fileSystem.stat(filePath)
        }) as StoreFileSystem['stat'],
      }),
    })

    expect(await collect(store.list())).toEqual([other])
  })

  it('passes on a failure to read a directory other than "not there"', async () => {
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        readdir: (async () => {
          throw systemError('EACCES')
        }) as unknown as StoreFileSystem['readdir'],
      }),
    })

    await expect(collect(store.list())).rejects.toMatchObject({ code: 'EACCES' })
  })
})

describe('sweepStaleTemporaryFiles', () => {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000)

  const plantTemporaryFile = async (name: string, modifiedAt: Date) => {
    const filePath = path.join(root, 'tmp', name)
    await fileSystem.mkdir(path.dirname(filePath), { recursive: true })
    await fileSystem.writeFile(filePath, 'partial')
    await fileSystem.utimes(filePath, modifiedAt, modifiedAt)
  }

  it('deletes temporary files older than an hour and keeps newer ones', async () => {
    await plantTemporaryFile('old-one', hoursAgo(3))
    await plantTemporaryFile('old-two', hoursAgo(1.5))
    await plantTemporaryFile('fresh', hoursAgo(0.5))
    const store = createLocalBlobStore({ root })

    const deleted = await store.sweepStaleTemporaryFiles()

    expect(deleted).toBe(2)
    expect(await temporaryFiles()).toEqual(['fresh'])
  })

  it('draws the line at one hour on the injected clock', async () => {
    await plantTemporaryFile('edge', new Date(1_000_000))
    const justInside = createLocalBlobStore({ root, now: () => 1_000_000 + STALE_TEMPORARY_FILE_MS })
    expect(await justInside.sweepStaleTemporaryFiles()).toBe(0)

    const justOutside = createLocalBlobStore({ root, now: () => 1_000_000 + STALE_TEMPORARY_FILE_MS + 1 })
    expect(await justOutside.sweepStaleTemporaryFiles()).toBe(1)
  })

  it('never touches finished blobs', async () => {
    const store = createLocalBlobStore({ root, now: () => Date.now() + 10 * STALE_TEMPORARY_FILE_MS })
    await store.put(hello)

    expect(await store.sweepStaleTemporaryFiles()).toBe(0)
    expect(await store.get(HELLO_DIGEST)).toEqual(hello)
  })

  it('does nothing when there is no temporary directory yet', async () => {
    const store = createLocalBlobStore({ root })

    expect(await store.sweepStaleTemporaryFiles()).toBe(0)
  })

  it('skips a file that vanishes before it can be examined, or before it can be deleted', async () => {
    await plantTemporaryFile('examined', hoursAgo(3))
    await plantTemporaryFile('raced', hoursAgo(3))
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        stat: (async (filePath: string) => {
          if (filePath.endsWith('examined')) throw systemError('ENOENT')
          return fileSystem.stat(filePath)
        }) as StoreFileSystem['stat'],
        unlink: async () => {
          throw systemError('ENOENT')
        },
      }),
    })

    expect(await store.sweepStaleTemporaryFiles()).toBe(0)
    expect(logMock).not.toHaveBeenCalled()
  })

  it('logs a file it cannot delete and carries on with the rest', async () => {
    await plantTemporaryFile('a-stubborn', hoursAgo(3))
    await plantTemporaryFile('b-removable', hoursAgo(3))
    const store = createLocalBlobStore({
      root,
      fileSystem: withFaults({
        unlink: (async (filePath: string) => {
          if (filePath.endsWith('a-stubborn')) throw systemError('EACCES')
          return fileSystem.unlink(filePath)
        }) as StoreFileSystem['unlink'],
      }),
    })

    expect(await store.sweepStaleTemporaryFiles()).toBe(1)
    expect(logMock).toHaveBeenCalledTimes(1)
    expect(await temporaryFiles()).toEqual(['a-stubborn'])
  })
})
