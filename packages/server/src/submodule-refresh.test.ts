import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  COMMAND_TIMEOUT_MS,
  REFRESH_ATTEMPTS,
  REFRESH_RETRY_DELAY_MS,
  SUBMODULE_PROVIDER_KEYS,
  SUBMODULE_SPECS,
  cloneCommands,
  createSystemDependencies,
  everyRepositoryPresent,
  isRefreshEnabled,
  refreshSubmodule,
  refreshSubmodules,
  refreshSubmodulesForProviders,
  specsForProviders,
  updateCommands,
  type RefreshDependencies,
  type SubmoduleSpec,
} from './submodule-refresh'
import { SUBMODULE_REPOSITORIES } from './submodule-source'
import { root } from './paths'

const spec: SubmoduleSpec = {
  name: 'sample',
  url: 'https://example.test/owner/sample',
  branch: 'main',
  sparsePaths: ['tokens', 'chains'],
}

/** A fake in which the file system is a set of existing paths and every git call is recorded. */
const createFake = (options: { existing?: string[]; failures?: ((args: readonly string[]) => boolean)[] } = {}) => {
  const existing = new Set(options.existing ?? [])
  const calls: string[][] = []
  const operations: string[] = []
  const logs: string[] = []
  const waits: number[] = []
  const dependencies: RefreshDependencies = {
    runCommand: vi.fn(async (_command, args) => {
      calls.push([...args])
      if (options.failures?.some((fails) => fails(args))) throw new Error('network down')
    }),
    pathExists: async (target) => existing.has(target),
    removeDirectory: async (target) => {
      operations.push(`remove ${target}`)
      existing.delete(target)
    },
    renameDirectory: async (from, to) => {
      operations.push(`rename ${from} ${to}`)
      existing.delete(from)
      existing.add(to)
    },
    makeDirectory: async (target) => {
      operations.push(`mkdir ${target}`)
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds)
    },
    log: (message) => logs.push(message),
  }
  return { dependencies, calls, operations, logs, waits, existing }
}

const isClone = (args: readonly string[]) => args[0] === 'clone'
const isFetch = (args: readonly string[]) => args.includes('fetch')
const isReset = (args: readonly string[]) => args.includes('reset')

describe('SUBMODULE_SPECS', () => {
  it('names the same repositories, addresses and branches as SUBMODULE_REPOSITORIES', () => {
    expect(SUBMODULE_SPECS.map((entry) => entry.name).sort()).toEqual(Object.keys(SUBMODULE_REPOSITORIES).sort())
    for (const entry of SUBMODULE_SPECS) {
      const known = SUBMODULE_REPOSITORIES[entry.name]
      expect(entry.url.replace(/\.git$/, '').toLowerCase()).toBe(
        `https://github.com/${known.owner}/${known.repo}`.toLowerCase(),
      )
      expect(entry.branch).toBe(known.defaultBranch)
    }
  })

  it('matches the addresses in .gitmodules', () => {
    const gitmodules = fs.readFileSync(path.join(root, '..', '..', '.gitmodules'), 'utf8')
    for (const entry of SUBMODULE_SPECS) {
      expect(gitmodules).toContain(`path = submodules/${entry.name}`)
      expect(gitmodules).toContain(`url = ${entry.url}`)
    }
  })

  it('checks out exactly the directories each collector reads', () => {
    expect(Object.fromEntries(SUBMODULE_SPECS.map((entry) => [entry.name, entry.sparsePaths]))).toEqual({
      trustwallet: ['blockchains'],
      'smoldapp-tokenassets': ['tokens', 'chains'],
      'ethereum-lists-tokens': ['tokens'],
      'pulsechain-assets': ['blockchain/pulsechain/assets'],
    })
  })

  it('has a provider key for every repository', () => {
    expect(Object.keys(SUBMODULE_PROVIDER_KEYS).sort()).toEqual(SUBMODULE_SPECS.map((entry) => entry.name).sort())
  })
})

describe('specsForProviders', () => {
  it('picks only the repositories the selected providers read', () => {
    expect(specsForProviders(['smoldapp', 'coingecko']).map((entry) => entry.name)).toEqual(['smoldapp-tokenassets'])
  })

  it('picks nothing when no provider reads from disk', () => {
    expect(specsForProviders(['coingecko'])).toEqual([])
  })

  it('picks all four, in table order, when every disk provider is selected', () => {
    const keys = Object.values(SUBMODULE_PROVIDER_KEYS)
    expect(specsForProviders(keys).map((entry) => entry.name)).toEqual(SUBMODULE_SPECS.map((entry) => entry.name))
  })
})

describe('cloneCommands', () => {
  it('clones one commit, without file contents, without tags, and checks out only the sparse paths', () => {
    expect(cloneCommands(spec, '/tmp/out')).toEqual([
      [
        'clone',
        '--depth',
        '1',
        '--filter=blob:none',
        '--no-tags',
        '--sparse',
        '--single-branch',
        '--branch',
        'main',
        'https://example.test/owner/sample',
        '/tmp/out',
      ],
      ['-C', '/tmp/out', 'sparse-checkout', 'set', 'tokens', 'chains'],
    ])
  })
})

describe('updateCommands', () => {
  it('fetches one commit of the branch, then applies it, and drops the old commit', () => {
    const { fetch, apply } = updateCommands(spec, '/tmp/out')
    expect(fetch).toEqual([
      '-C',
      '/tmp/out',
      'fetch',
      '--depth',
      '1',
      '--filter=blob:none',
      '--no-tags',
      'origin',
      'main',
    ])
    expect(apply.map((args) => args.filter((arg) => !arg.startsWith('-')).join(' '))).toEqual([
      '/tmp/out sparse-checkout set tokens chains',
      '/tmp/out reset FETCH_HEAD',
      '/tmp/out gc.reflogExpire=now gc.reflogExpireUnreachable=now gc',
    ])
    expect(apply[1]).toEqual(['-C', '/tmp/out', 'reset', '--hard', 'FETCH_HEAD'])
    expect(apply[2]).toContain('--prune=now')
  })
})

describe('isRefreshEnabled', () => {
  it.each([
    ['true', true],
    [' TRUE ', true],
    ['false', false],
    ['', false],
    ['1', false],
    [undefined, false],
  ])('reads %j as %s', (value, expected) => {
    expect(isRefreshEnabled(value)).toBe(expected)
  })
})

describe('refreshSubmodule', () => {
  const target = path.join('/data', 'sample')

  it('clones into a staging directory and moves it into place when there is no checkout', async () => {
    const fake = createFake()
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome).toEqual({ name: 'sample', action: 'cloned' })
    expect(fake.calls).toEqual(cloneCommands(spec, `${target}.cloning`))
    expect(fake.operations).toEqual([
      'mkdir /data',
      `remove ${target}.cloning`,
      `remove ${target}`,
      `rename ${target}.cloning ${target}`,
    ])
    expect(fake.logs).toEqual(['submodule sample: cloned'])
  })

  it('replaces a directory that has no git metadata instead of updating it', async () => {
    const fake = createFake({ existing: [target] })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome.action).toBe('cloned')
    expect(fake.calls.some(isFetch)).toBe(false)
    expect(fake.operations).toContain(`remove ${target}`)
  })

  it('updates in place when a checkout exists', async () => {
    const fake = createFake({ existing: [path.join(target, '.git')] })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)
    const { fetch, apply } = updateCommands(spec, target)

    expect(outcome).toEqual({ name: 'sample', action: 'updated' })
    expect(fake.calls).toEqual([[...fetch], ...apply.map((args) => [...args])])
    expect(fake.operations).toEqual(['mkdir /data'])
  })

  it('retries a failed fetch, waiting between attempts, and succeeds when a later attempt works', async () => {
    let fetches = 0
    const fake = createFake({
      existing: [path.join(target, '.git')],
      failures: [(args) => isFetch(args) && ++fetches < REFRESH_ATTEMPTS],
    })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome.action).toBe('updated')
    expect(fetches).toBe(REFRESH_ATTEMPTS)
    expect(fake.waits).toEqual(Array(REFRESH_ATTEMPTS - 1).fill(REFRESH_RETRY_DELAY_MS))
  })

  it('keeps the copy on disk when every fetch fails, and never touches the working tree', async () => {
    const fake = createFake({ existing: [path.join(target, '.git')], failures: [isFetch] })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome).toEqual({ name: 'sample', action: 'kept', reason: 'network down' })
    expect(fake.calls.filter(isFetch)).toHaveLength(REFRESH_ATTEMPTS)
    expect(fake.calls.some(isReset)).toBe(false)
    expect(fake.waits).toHaveLength(REFRESH_ATTEMPTS - 1)
    expect(fake.logs[0]).toContain('refresh failed (network down); kept')
  })

  it('does not retry a failure after the fetch, which would only repeat', async () => {
    const fake = createFake({ existing: [path.join(target, '.git')], failures: [isReset] })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome.action).toBe('kept')
    expect(fake.calls.filter(isReset)).toHaveLength(1)
  })

  it('reports missing, and removes its staging directory, when a first clone fails every attempt', async () => {
    const fake = createFake({ failures: [isClone] })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome).toEqual({ name: 'sample', action: 'missing', reason: 'network down' })
    expect(fake.calls.filter(isClone)).toHaveLength(REFRESH_ATTEMPTS)
    expect(fake.operations.at(-1)).toBe(`remove ${target}.cloning`)
    expect(fake.operations.some((operation) => operation.startsWith('rename'))).toBe(false)
  })

  it('keeps an unpacked directory without git metadata when the clone that would replace it fails', async () => {
    const fake = createFake({ existing: [target], failures: [isClone] })
    const outcome = await refreshSubmodule(fake.dependencies, '/data', spec)

    expect(outcome.action).toBe('kept')
    expect(fake.operations).not.toContain(`remove ${target}`)
  })

  it('describes a thrown value that is not an Error by its text', async () => {
    const fake = createFake()
    const failing: RefreshDependencies = {
      ...fake.dependencies,
      makeDirectory: async () => {
        throw 'disk full'
      },
    }
    const outcome = await refreshSubmodule(failing, '/data', spec)

    expect(outcome).toEqual({ name: 'sample', action: 'missing', reason: 'disk full' })
  })
})

describe('refreshSubmodules', () => {
  it('refreshes each repository in order and keeps going past a failure', async () => {
    const second: SubmoduleSpec = { ...spec, name: 'other' }
    const fake = createFake({ failures: [(args) => args.includes(spec.url)] })
    const outcomes = await refreshSubmodules(fake.dependencies, '/data', [spec, second])

    expect(outcomes.map((outcome) => [outcome.name, outcome.action])).toEqual([
      ['sample', 'missing'],
      ['other', 'missing'],
    ])
  })

  it('refreshes all four known repositories by default', async () => {
    const fake = createFake()
    const outcomes = await refreshSubmodules(fake.dependencies, '/data')

    expect(outcomes.map((outcome) => outcome.name)).toEqual(SUBMODULE_SPECS.map((entry) => entry.name))
    expect(everyRepositoryPresent(outcomes)).toBe(true)
  })
})

describe('everyRepositoryPresent', () => {
  it('is false only when a repository has nothing on disk', () => {
    expect(everyRepositoryPresent([{ name: 'a', action: 'kept' }])).toBe(true)
    expect(
      everyRepositoryPresent([
        { name: 'a', action: 'cloned' },
        { name: 'b', action: 'missing' },
      ]),
    ).toBe(false)
  })
})

describe('createSystemDependencies', () => {
  const makeTemporaryDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'submodule-refresh-'))

  it('runs a command to completion, and rejects when it exits non-zero', async () => {
    const dependencies = createSystemDependencies(() => undefined)
    await expect(dependencies.runCommand(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBeUndefined()
    await expect(dependencies.runCommand(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow()
  })

  it('stops git from asking for credentials', async () => {
    const dependencies = createSystemDependencies(() => undefined)
    await expect(
      dependencies.runCommand(process.execPath, [
        '-e',
        "process.exit(process.env.GIT_TERMINAL_PROMPT === '0' ? 0 : 1)",
      ]),
    ).resolves.toBeUndefined()
  })

  it('creates, finds, moves and deletes directories, and treats a missing one as already deleted', async () => {
    const dependencies = createSystemDependencies(() => undefined)
    const root = makeTemporaryDirectory()
    try {
      const nested = path.join(root, 'a', 'b')
      await dependencies.makeDirectory(nested)
      expect(await dependencies.pathExists(nested)).toBe(true)
      await dependencies.renameDirectory(nested, path.join(root, 'moved'))
      expect(await dependencies.pathExists(nested)).toBe(false)
      expect(await dependencies.pathExists(path.join(root, 'moved'))).toBe(true)
      await dependencies.removeDirectory(path.join(root, 'moved'))
      await dependencies.removeDirectory(path.join(root, 'moved'))
      expect(await dependencies.pathExists(path.join(root, 'moved'))).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('waits for the time given and forwards log lines', async () => {
    const lines: string[] = []
    const dependencies = createSystemDependencies((line) => lines.push(line))
    await dependencies.wait(1)
    dependencies.log('hello')
    expect(lines).toEqual(['hello'])
  })

  it('bounds how long one git command can run', () => {
    expect(COMMAND_TIMEOUT_MS).toBeGreaterThan(60_000)
  })
})

describe('against a real repository', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd,
        stdio: 'pipe',
      },
    )
  const hasGit = (() => {
    try {
      execFileSync('git', ['--version'], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  })()

  it.skipIf(!hasGit)(
    'clones sparse and shallow, then moves to a new commit, then keeps the copy when the origin disappears',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'submodule-refresh-real-'))
      try {
        const origin = path.join(root, 'origin')
        fs.mkdirSync(path.join(origin, 'tokens'), { recursive: true })
        fs.mkdirSync(path.join(origin, 'unread'), { recursive: true })
        git(root, 'init', '--quiet', '--initial-branch', 'main', origin)
        git(origin, 'config', 'uploadpack.allowFilter', 'true')
        git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
        fs.writeFileSync(path.join(origin, 'tokens', 'first.json'), '{"n":1}')
        fs.writeFileSync(path.join(origin, 'unread', 'big.bin'), 'not read by any collector')
        git(origin, 'add', '.')
        git(origin, 'commit', '--quiet', '-m', 'first')

        const real: SubmoduleSpec = {
          name: 'real',
          url: `file://${origin}`,
          branch: 'main',
          sparsePaths: ['tokens'],
        }
        const directory = path.join(root, 'subs')
        const dependencies = createSystemDependencies(() => undefined)
        const target = path.join(directory, 'real')

        expect((await refreshSubmodule(dependencies, directory, real)).action).toBe('cloned')
        expect(fs.readFileSync(path.join(target, 'tokens', 'first.json'), 'utf8')).toBe('{"n":1}')
        expect(fs.existsSync(path.join(target, 'unread'))).toBe(false)
        expect(git(target, 'rev-list', '--count', 'HEAD').toString().trim()).toBe('1')
        expect(fs.existsSync(`${target}.cloning`)).toBe(false)

        fs.writeFileSync(path.join(origin, 'tokens', 'second.json'), '{"n":2}')
        git(origin, 'add', '.')
        git(origin, 'commit', '--quiet', '-m', 'second')

        expect((await refreshSubmodule(dependencies, directory, real)).action).toBe('updated')
        expect(fs.readFileSync(path.join(target, 'tokens', 'second.json'), 'utf8')).toBe('{"n":2}')
        expect(git(target, 'rev-list', '--count', 'HEAD').toString().trim()).toBe('1')
        expect(fs.existsSync(path.join(target, 'unread'))).toBe(false)

        fs.rmSync(origin, { recursive: true, force: true })
        const quiet = { ...dependencies, wait: async () => undefined }
        const outcome = await refreshSubmodule(quiet, directory, real)
        expect(outcome.action).toBe('kept')
        expect(fs.readFileSync(path.join(target, 'tokens', 'second.json'), 'utf8')).toBe('{"n":2}')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    },
    60_000,
  )
})

describe('refreshSubmodulesForProviders', () => {
  it('does nothing, and touches no directory, when no selected provider reads from disk', async () => {
    const lines: string[] = []
    const outcomes = await refreshSubmodulesForProviders('/definitely/not/created', ['coingecko'], (line) =>
      lines.push(line),
    )
    expect(outcomes).toEqual([])
    expect(lines).toEqual([])
  })
})
