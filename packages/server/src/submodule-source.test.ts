import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as paths from './paths'

beforeEach(() => {
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

describe('publicSourceAddress', () => {
  it('records each repository on its default branch, keyed by the file path', async () => {
    // The default branch, not a commit. An image's identity hashes its bytes with its
    // address, so an address that moved with each upstream commit gave every
    // unchanged file a new identity and a new stored copy on every commit - five
    // copies each of Trust Wallet's 14,603 files within a week. A file that really
    // changes upstream still gets a new identity, from its new bytes.
    const { publicSourceAddress } = await importModule()
    const at = (...parts: string[]) => publicSourceAddress(path.join(paths.submodules, ...parts))

    expect(at('trustwallet', 'blockchains', 'smartchain', 'assets', '0xAbc', 'logo.png')).toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0xAbc/logo.png',
    )
    expect(at('smoldapp-tokenassets', 'tokens', '1', '0xabc', 'logo.svg')).toBe(
      'https://raw.githubusercontent.com/SmolDapp/tokenAssets/main/tokens/1/0xabc/logo.svg',
    )
    expect(at('ethereum-lists-tokens', 'tokens', 'eth', '0xAbc.json')).toBe(
      'https://raw.githubusercontent.com/ethereum-lists/tokens/master/tokens/eth/0xAbc.json',
    )
    expect(at('pulsechain-assets', 'blockchain', 'pulsechain', 'assets', '0xAbc', 'logo.png')).toBe(
      'https://raw.githubusercontent.com/PLS369/pulsechain-assets/main/blockchain/pulsechain/assets/0xAbc/logo.png',
    )
  })

  it('percent-encodes a path segment without touching the / separators', async () => {
    const { publicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'trustwallet', 'blockchains', 'a chain', 'logo.png')

    expect(publicSourceAddress(localPath)).toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/a%20chain/logo.png',
    )
  })

  it('returns null for a path outside any known submodule', async () => {
    const { publicSourceAddress } = await importModule()

    expect(publicSourceAddress(path.join(paths.images, 'variant.png'))).toBeNull()
  })

  it('returns null for null and undefined', async () => {
    const { publicSourceAddress } = await importModule()

    expect(publicSourceAddress(null)).toBeNull()
    expect(publicSourceAddress(undefined)).toBeNull()
  })
})

describe('requirePublicSourceAddress', () => {
  it('returns the same address publicSourceAddress would produce', async () => {
    const { requirePublicSourceAddress } = await importModule()
    const localPath = path.join(paths.submodules, 'trustwallet', 'blockchains', 'smartchain', 'logo.png')

    expect(requirePublicSourceAddress(localPath)).toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/logo.png',
    )
  })

  it('throws for a path outside any known submodule, rather than falling back to it', async () => {
    const { requirePublicSourceAddress } = await importModule()
    const localPath = path.join(paths.images, 'variant.png')

    expect(() => requirePublicSourceAddress(localPath)).toThrow(`no public address for submodule path ${localPath}`)
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
