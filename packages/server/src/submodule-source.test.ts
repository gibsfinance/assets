import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as paths from './paths'

/**
 * `resolveSubmoduleRef` shells out to `git rev-parse HEAD` via `node:child_process`.
 * Mocked here so every test in this file is deterministic and never depends on
 * which commit happens to be checked out in the real `submodules/` tree, or on
 * `git` being callable at all in the environment running the suite.
 */
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile }))

/** Wires the next `execFile(...)` call to succeed with the given stdout. */
const succeedWith = (stdout: string) => {
  execFile.mockImplementationOnce((_cmd: string, _args: string[], callback: (...args: unknown[]) => void) => {
    callback(null, stdout, '')
  })
}

/** Wires the next `execFile(...)` call to fail, as it would with no `.git` present. */
const failWith = (message: string) => {
  execFile.mockImplementationOnce((_cmd: string, _args: string[], callback: (...args: unknown[]) => void) => {
    callback(new Error(message), '', message)
  })
}

beforeEach(() => {
  execFile.mockReset()
  vi.resetModules()
})

const importModule = () => import('./submodule-source')

describe('SUBMODULE_REPOSITORIES', () => {
  it('names the exact owner, repository, and default branch for each of the four vendored submodules', async () => {
    const { SUBMODULE_REPOSITORIES } = await importModule()

    // Verified directly against .gitmodules and each submodule's own
    // `git remote get-url origin` / `git symbolic-ref refs/remotes/origin/HEAD`.
    expect(SUBMODULE_REPOSITORIES).toEqual({
      trustwallet: { owner: 'trustwallet', repo: 'assets', defaultBranch: 'master' },
      'smoldapp-tokenassets': { owner: 'SmolDapp', repo: 'tokenAssets', defaultBranch: 'main' },
      'ethereum-lists-tokens': { owner: 'ethereum-lists', repo: 'tokens', defaultBranch: 'master' },
      'pulsechain-assets': { owner: 'PLS369', repo: 'pulsechain-assets', defaultBranch: 'main' },
    })
  })
})

describe('locateSubmodulePath', () => {
  it.each([
    ['trustwallet', 'blockchains/smartchain/assets/0xAbc/logo.png'],
    ['smoldapp-tokenassets', 'tokens/1/0xabc/logo.svg'],
    ['ethereum-lists-tokens', 'tokens/eth/0xAbc.json'],
    ['pulsechain-assets', 'blockchain/pulsechain/assets/0xAbc/logo.png'],
  ])('maps a path inside %s to that submodule and the path within it', async (submoduleName, relative) => {
    const { locateSubmodulePath } = await importModule()
    const localPath = path.join(paths.submodules, submoduleName, relative)

    expect(locateSubmodulePath(localPath)).toEqual({ submoduleName, pathWithinSubmodule: relative })
  })

  it('returns null for a path outside the submodules directory entirely', async () => {
    const { locateSubmodulePath } = await importModule()

    expect(locateSubmodulePath(path.join(paths.images, 'some-cached-variant.png'))).toBeNull()
  })

  it('returns null for a path that climbs out of the submodules directory via ..', async () => {
    const { locateSubmodulePath } = await importModule()

    expect(locateSubmodulePath(path.join(paths.submodules, '..', 'etc', 'passwd'))).toBeNull()
  })

  it('returns null for a path directly under submodules/ naming an unknown directory', async () => {
    const { locateSubmodulePath } = await importModule()

    expect(locateSubmodulePath(path.join(paths.submodules, 'not-a-real-submodule', 'logo.png'))).toBeNull()
  })

  it('returns null for the submodule root itself, which names no single file', async () => {
    const { locateSubmodulePath } = await importModule()

    expect(locateSubmodulePath(path.join(paths.submodules, 'trustwallet'))).toBeNull()
  })

  it('returns null for a relative path, even one that would resolve into a known submodule from the working directory', async () => {
    const { locateSubmodulePath } = await importModule()
    // Constructed so that resolving it against process.cwd() (what a relative
    // path implicitly does) lands on exactly the same absolute file a genuine
    // caller would pass — the only thing distinguishing it is that it is
    // relative. Without the isAbsolute guard this would wrongly resolve.
    const absolutePath = path.join(paths.submodules, 'trustwallet', 'blockchains', 'smartchain', 'logo.png')
    const relativeToCwd = path.relative(process.cwd(), absolutePath)

    expect(locateSubmodulePath(relativeToCwd)).toBeNull()
  })

  it('returns null for null, undefined, and the empty string', async () => {
    const { locateSubmodulePath } = await importModule()

    expect(locateSubmodulePath(null)).toBeNull()
    expect(locateSubmodulePath(undefined)).toBeNull()
    expect(locateSubmodulePath('')).toBeNull()
  })
})

describe('resolveSubmoduleRef', () => {
  it('resolves to the checked-out commit when git rev-parse succeeds', async () => {
    succeedWith('cf627981a583ad25bb90669deb2b1d8819bfbb2f\n')
    const { resolveSubmoduleRef } = await importModule()

    await expect(resolveSubmoduleRef('trustwallet')).resolves.toBe('cf627981a583ad25bb90669deb2b1d8819bfbb2f')
  })

  it("runs git rev-parse HEAD against the submodule's own checkout directory", async () => {
    succeedWith('abc123\n')
    const { resolveSubmoduleRef } = await importModule()

    await resolveSubmoduleRef('smoldapp-tokenassets')

    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['-C', path.join(paths.submodules, 'smoldapp-tokenassets'), 'rev-parse', 'HEAD'],
      expect.any(Function),
    )
  })

  it('falls back to the repository default branch when git rev-parse fails', async () => {
    failWith('fatal: not a git repository')
    const { resolveSubmoduleRef } = await importModule()

    await expect(resolveSubmoduleRef('ethereum-lists-tokens')).resolves.toBe('master')
  })

  it('falls back to the default branch when git rev-parse succeeds with empty output', async () => {
    succeedWith('   \n')
    const { resolveSubmoduleRef } = await importModule()

    await expect(resolveSubmoduleRef('pulsechain-assets')).resolves.toBe('main')
  })

  it('resolves a submodule commit once per process and reuses it on every later call', async () => {
    succeedWith('deadbeef\n')
    const { resolveSubmoduleRef } = await importModule()

    const first = await resolveSubmoduleRef('trustwallet')
    const second = await resolveSubmoduleRef('trustwallet')
    const third = await resolveSubmoduleRef('trustwallet')

    expect([first, second, third]).toEqual(['deadbeef', 'deadbeef', 'deadbeef'])
    // Only the first call actually shells out — this is what "resolve once per
    // run and reuse it" means: a collection run touching thousands of images
    // from the same submodule pays the process-spawn cost exactly once.
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('resolves each submodule independently, so one cache entry never answers for another', async () => {
    succeedWith('trustwallet-commit\n')
    succeedWith('smoldapp-commit\n')
    const { resolveSubmoduleRef } = await importModule()

    const trustwalletRef = await resolveSubmoduleRef('trustwallet')
    const smoldappRef = await resolveSubmoduleRef('smoldapp-tokenassets')

    expect(trustwalletRef).toBe('trustwallet-commit')
    expect(smoldappRef).toBe('smoldapp-commit')
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('resetSubmoduleRefCache forces the next call to resolve again', async () => {
    succeedWith('first-commit\n')
    const { resolveSubmoduleRef, resetSubmoduleRefCache } = await importModule()

    await resolveSubmoduleRef('trustwallet')
    resetSubmoduleRefCache()
    succeedWith('second-commit\n')
    const second = await resolveSubmoduleRef('trustwallet')

    expect(second).toBe('second-commit')
    expect(execFile).toHaveBeenCalledTimes(2)
  })
})

describe('publicSourceAddress', () => {
  it('builds a commit-pinned raw.githubusercontent.com address for a path inside trustwallet', async () => {
    succeedWith('cf627981a583ad25bb90669deb2b1d8819bfbb2f\n')
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(
      paths.submodules,
      'trustwallet',
      'blockchains',
      'smartchain',
      'assets',
      '0xAbc',
      'logo.png',
    )

    await expect(publicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/cf627981a583ad25bb90669deb2b1d8819bfbb2f/blockchains/smartchain/assets/0xAbc/logo.png',
    )
  })

  it('builds a commit-pinned address for a path inside smoldapp-tokenassets', async () => {
    succeedWith('68e588727338ea9c6fc3494813833f0b0717fcbe\n')
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'smoldapp-tokenassets', 'tokens', '1', '0xabc', 'logo.svg')

    await expect(publicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/SmolDapp/tokenAssets/68e588727338ea9c6fc3494813833f0b0717fcbe/tokens/1/0xabc/logo.svg',
    )
  })

  it('builds a commit-pinned address for a path inside ethereum-lists-tokens', async () => {
    succeedWith('55622d80c18cc5cabaa8cb9a4c4214daaa9cf05e\n')
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'ethereum-lists-tokens', 'tokens', 'eth', '0xAbc.json')

    await expect(publicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/ethereum-lists/tokens/55622d80c18cc5cabaa8cb9a4c4214daaa9cf05e/tokens/eth/0xAbc.json',
    )
  })

  it('builds a commit-pinned address for a path inside pulsechain-assets', async () => {
    succeedWith('79c31de1b6df6a4861abe5220cecb07c088fb77e\n')
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(
      paths.submodules,
      'pulsechain-assets',
      'blockchain',
      'pulsechain',
      'assets',
      '0xAbc',
      'logo.png',
    )

    await expect(publicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/PLS369/pulsechain-assets/79c31de1b6df6a4861abe5220cecb07c088fb77e/blockchain/pulsechain/assets/0xAbc/logo.png',
    )
  })

  it('falls back to the default branch in the address when the commit cannot be resolved', async () => {
    failWith('fatal: not a git repository')
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'pulsechain-assets', 'blockchain', 'pulsechain', 'assets', 'x.png')

    await expect(publicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/PLS369/pulsechain-assets/main/blockchain/pulsechain/assets/x.png',
    )
  })

  it('percent-encodes a path segment without touching the / separators', async () => {
    succeedWith('deadbeef\n')
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'trustwallet', 'blockchains', 'a chain', 'logo.png')

    await expect(publicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/deadbeef/blockchains/a%20chain/logo.png',
    )
  })

  it('returns null for a path outside any known submodule', async () => {
    const { publicSourceAddress } = await importModule()

    await expect(publicSourceAddress(path.join(paths.images, 'variant.png'))).resolves.toBeNull()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('returns null for null and undefined without shelling out', async () => {
    const { publicSourceAddress } = await importModule()

    await expect(publicSourceAddress(null)).resolves.toBeNull()
    await expect(publicSourceAddress(undefined)).resolves.toBeNull()
    expect(execFile).not.toHaveBeenCalled()
  })
})

describe('requirePublicSourceAddress', () => {
  it('resolves to the same address publicSourceAddress would produce', async () => {
    succeedWith('deadbeef\n')
    const { requirePublicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'trustwallet', 'blockchains', 'smartchain', 'logo.png')

    await expect(requirePublicSourceAddress(localPath)).resolves.toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/deadbeef/blockchains/smartchain/logo.png',
    )
  })

  it('throws for a path outside any known submodule, rather than falling back to it', async () => {
    const { requirePublicSourceAddress } = await importModule()
    const localPath = path.join(paths.images, 'variant.png')

    await expect(requirePublicSourceAddress(localPath)).rejects.toThrow(
      `no public address for submodule path ${localPath}`,
    )
  })
})

describe('submoduleNameForPublicAddress', () => {
  it('reads each known repository back out of its public address', async () => {
    const { submoduleNameForPublicAddress } = await importModule()
    const base = 'https://raw.githubusercontent.com'
    expect(submoduleNameForPublicAddress(`${base}/trustwallet/assets/abc/blockchains/x/logo.png`)).toBe('trustwallet')
    expect(submoduleNameForPublicAddress(`${base}/SmolDapp/tokenAssets/abc/chains/1/logo.svg`)).toBe(
      'smoldapp-tokenassets',
    )
    expect(submoduleNameForPublicAddress(`${base}/ethereum-lists/tokens/abc/tokens/eth/x.json`)).toBe(
      'ethereum-lists-tokens',
    )
    expect(submoduleNameForPublicAddress(`${base}/PLS369/pulsechain-assets/abc/x/logo.png`)).toBe('pulsechain-assets')
  })

  it('ignores case in the owner and repository, the way the forge does', async () => {
    const { submoduleNameForPublicAddress } = await importModule()
    expect(submoduleNameForPublicAddress('https://raw.githubusercontent.com/smoldapp/TOKENASSETS/abc/logo.svg')).toBe(
      'smoldapp-tokenassets',
    )
  })

  it('does not claim a repository it does not know, even on the same host', async () => {
    // Every public address shares this host, so the host alone names nothing. An
    // unknown repository is somebody else's, and gets no source rather than a guess.
    const { submoduleNameForPublicAddress } = await importModule()
    expect(submoduleNameForPublicAddress('https://raw.githubusercontent.com/someone/else/abc/logo.png')).toBeNull()
  })

  it('does not claim an address on another host, even with an identical path', async () => {
    // The path is copied exactly, so only the host check can turn this away. An earlier
    // version of this test used a mirror whose path is shaped differently, and it passed
    // with the host check deleted - it was testing the path, not the host.
    const { submoduleNameForPublicAddress } = await importModule()
    expect(submoduleNameForPublicAddress('https://example.com/SmolDapp/tokenAssets/abc/chains/1/logo.svg')).toBeNull()
  })

  it('answers null for an address it cannot read at all', async () => {
    const { submoduleNameForPublicAddress } = await importModule()
    expect(submoduleNameForPublicAddress(undefined)).toBeNull()
    expect(submoduleNameForPublicAddress('not an address')).toBeNull()
    expect(submoduleNameForPublicAddress('https://raw.githubusercontent.com/only-owner')).toBeNull()
  })
})
