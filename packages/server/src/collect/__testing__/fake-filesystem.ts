/**
 * Shared filesystem stand-in for the three collectors that walk a git submodule
 * directory tree instead of fetching a remote list — `ethereum-lists.ts`,
 * `trustwallet.ts`, and `smoldapp.ts`. These collectors call `fs.promises.readdir`,
 * `fs.promises.readFile`, and (trustwallet only) `fs.promises.stat` directly, so
 * `collector-harness.ts`'s network-fetch seam (`cachedJSONRequest`) does not model
 * their input at all — this module is the filesystem equivalent of that seam.
 *
 * ## Usage
 *
 * Mirrors `collector-harness.ts`'s own pattern: a single exported, ready-made
 * `fakeFilesystem` singleton (safe to reference from a lazily-evaluated `vi.mock()`
 * factory, unlike `vi.hoisted()`), plus `createFakeFilesystem()` for a test file
 * that genuinely needs a second, independent instance.
 *
 * ```ts
 * import { vi, beforeEach } from 'vitest'
 * import { fakeFilesystem } from './__testing__/fake-filesystem'
 *
 * vi.mock('fs', () => ({ promises: fakeFilesystem.promises }))
 *
 * beforeEach(() => {
 *   fakeFilesystem.reset()
 * })
 *
 * import collector from './ethereum-lists'
 *
 * fakeFilesystem.setDirectory('/repo/tokens', ['eth'])
 * fakeFilesystem.setDirectory('/repo/tokens/eth', ['0xabc.json'])
 * fakeFilesystem.setFile('/repo/tokens/eth/0xabc.json', JSON.stringify({ ... }))
 * ```
 *
 * A collector under test computes its own absolute paths via `path.join` against
 * `../paths`, so a test registers fixtures under the same absolute paths the
 * collector will actually request — there is no path-normalization inside this
 * module to paper over a mismatch, deliberately, so a test that gets the path
 * wrong fails loudly (a missing-directory error) instead of silently matching
 * the wrong fixture.
 */
import { vi, type Mock } from 'vitest'

/** Everything a test can register or inspect for one fake filesystem instance. */
export type FakeFilesystemState = {
  directories: Map<string, string[]>
  files: Map<string, string | Buffer>
  // `unknown`, not `Error`: a test occasionally needs to exercise a catch
  // block's `err instanceof Error` false branch, which requires throwing
  // something that genuinely is not an `Error` instance (a bare string, for
  // example) — the fake filesystem must be able to rethrow exactly that.
  readdirErrors: Map<string, unknown>
  readFileErrors: Map<string, unknown>
  statFailures: Set<string>
}

const createEmptyState = (): FakeFilesystemState => ({
  directories: new Map(),
  files: new Map(),
  readdirErrors: new Map(),
  readFileErrors: new Map(),
  statFailures: new Set(),
})

/** Builds a Node-shaped ENOENT error, matching what a real failed `fs` call throws. */
const notFoundError = (targetPath: string): NodeJS.ErrnoException => {
  const error = new Error(`ENOENT: no such file or directory, '${targetPath}'`) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}

export type FakeFilesystem = {
  state: FakeFilesystemState
  /** The subset of `fs.promises` these collectors call — hand to `vi.mock('fs', ...)`. */
  promises: {
    readdir: Mock
    readFile: Mock
    stat: Mock
  }
  /** Registers the file names `fs.promises.readdir(dirPath)` should resolve to. */
  setDirectory: (dirPath: string, entries: string[]) => void
  /** Registers the contents `fs.promises.readFile(filePath)` should resolve to. */
  setFile: (filePath: string, contents: string | Buffer) => void
  /** Makes the next `fs.promises.readdir(dirPath)` call reject, ENOENT by default.
   * `error` may be any thrown value, not just an `Error`, to exercise a caller's
   * `err instanceof Error` handling of a non-`Error` rejection. */
  failReaddir: (dirPath: string, error?: unknown) => void
  /** Makes the next `fs.promises.readFile(filePath)` call reject, ENOENT by default.
   * `error` may be any thrown value, not just an `Error`, to exercise a caller's
   * `err instanceof Error` handling of a non-`Error` rejection. */
  failReadFile: (filePath: string, error?: unknown) => void
  /** Makes `fs.promises.stat(filePath)` reject even for a path that was registered. */
  failStat: (filePath: string) => void
  /** Clears every registered fixture and mock call history. Call from `beforeEach`. */
  reset: () => void
}

/** Builds one independent fake-filesystem instance. */
export const createFakeFilesystem = (): FakeFilesystem => {
  const state = createEmptyState()

  const readdir = vi.fn(async (dirPath: string): Promise<string[]> => {
    const error = state.readdirErrors.get(dirPath)
    if (error) throw error
    const entries = state.directories.get(dirPath)
    if (!entries) throw notFoundError(dirPath)
    return entries
  })

  const readFile = vi.fn(async (filePath: string): Promise<Buffer> => {
    const error = state.readFileErrors.get(filePath)
    if (error) throw error
    const contents = state.files.get(filePath)
    if (contents === undefined) throw notFoundError(filePath)
    return Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  })

  const stat = vi.fn(async (filePath: string): Promise<{ isFile: () => boolean }> => {
    if (state.statFailures.has(filePath)) throw notFoundError(filePath)
    if (state.files.has(filePath) || state.directories.has(filePath)) {
      return { isFile: () => state.files.has(filePath) }
    }
    throw notFoundError(filePath)
  })

  const reset = () => {
    state.directories.clear()
    state.files.clear()
    state.readdirErrors.clear()
    state.readFileErrors.clear()
    state.statFailures.clear()
    vi.clearAllMocks()
  }

  return {
    state,
    promises: { readdir, readFile, stat },
    setDirectory: (dirPath, entries) => state.directories.set(dirPath, entries),
    setFile: (filePath, contents) => state.files.set(filePath, contents),
    failReaddir: (dirPath, error) => state.readdirErrors.set(dirPath, error ?? notFoundError(dirPath)),
    failReadFile: (filePath, error) => state.readFileErrors.set(filePath, error ?? notFoundError(filePath)),
    failStat: (filePath) => state.statFailures.add(filePath),
    reset,
  }
}

/**
 * The instance every filesystem-backed collector test file should import and
 * hand to `vi.mock('fs', ...)`. See the module doc comment for why this is a
 * plain exported singleton rather than something built inside `vi.hoisted()`.
 */
export const fakeFilesystem: FakeFilesystem = createFakeFilesystem()
