import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as paths from '../paths'
import { NETWORK_MAPPING, parseTokenRecord, resolveChainId, resolveLogo } from './ethereum-lists-parse'
import { harness } from './__testing__/collector-harness'
import { fakeFilesystem } from './__testing__/fake-filesystem'

vi.mock('fs', () => ({ promises: fakeFilesystem.promises }))
vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
// ethereum-lists.ts pulls `limitBy` from `@gibs/utils` and calls it as `limitBy(key, count).map(items, fn)`.
// The real `@gibs/utils` `limitBy` returns a `promise-limit` instance, which has a
// `.map` method; the shared harness's `limitBy` mock returns a bare async function
// instead (matching every other collector's `limitBy(items, fn)` call shape), so it
// does not have `.map` and cannot be reused as-is here. Worth upstreaming: give the
// harness's `limitBy` mock a `.map` method so every calling convention works.
vi.mock('@gibs/utils', () => ({
  ...harness.gibsUtilsModule,
  limitBy: <T>(_key: string, _count = 16) => ({
    map: async (items: T[], fn: (item: T) => Promise<unknown>) => Promise.all(items.map(fn)),
  }),
}))

beforeEach(() => {
  harness.reset()
  fakeFilesystem.reset()
})

import ethereumLists, { collect } from './ethereum-lists'

/**
 * The slug -> chain-id map is transcribed by hand from the source repository's
 * Main.kt. A single wrong number would silently file every token in that folder
 * onto the wrong chain, so the exact map is locked here.
 */
describe('resolveChainId', () => {
  it('resolves each mapped slug to its authoritative chain id', () => {
    const expected: Record<string, number> = {
      eth: 1,
      esn: 2,
      ubq: 8,
      rsk: 30,
      bsc: 56,
      etc: 61,
      ella: 64,
      sonic: 146,
      vc: 207,
      zks: 324,
      arb: 42161,
      avax: 43114,
    }
    expect(NETWORK_MAPPING).toEqual(expected)
    for (const [slug, chainId] of Object.entries(expected)) {
      expect(resolveChainId(slug)).toEqual({ status: 'included', chainId })
    }
  })

  it('excludes the dead testnet folders whose chains no longer exist', () => {
    // Ropsten, Rinkeby, Goerli, and Kovan are shut down; ingesting them would create
    // dead networks, so they must resolve to 'excluded' rather than a chain id.
    for (const slug of ['rop', 'rin', 'gor', 'kov']) {
      expect(resolveChainId(slug)).toEqual({ status: 'excluded' })
    }
  })

  it('reports an unmapped, non-dead folder as unknown', () => {
    // A folder that is neither mapped nor a known dead testnet is a genuine unknown,
    // kept distinct from 'excluded' so the collector can surface it instead of ingesting it.
    expect(resolveChainId('does-not-exist')).toEqual({ status: 'unknown' })
  })
})

/**
 * The source documents `logo` as a plain string but ships it as an object in
 * practice, so both shapes must resolve; a token with no logo must still ingest
 * (empty string), never be dropped for lacking one.
 */
describe('resolveLogo', () => {
  it('reads the src of an object logo, the common on-disk shape', () => {
    expect(resolveLogo({ src: 'https://example.com/a.png', width: '32', height: '32' })).toBe(
      'https://example.com/a.png',
    )
  })

  it('accepts a plain string logo, the documented shape', () => {
    expect(resolveLogo('https://example.com/b.png')).toBe('https://example.com/b.png')
  })

  it('yields an empty string when the logo is missing or unusable', () => {
    // No logo is a valid state — the token still ingests, just without an image.
    expect(resolveLogo(undefined)).toBe('')
    expect(resolveLogo(null)).toBe('')
    expect(resolveLogo('')).toBe('')
    expect(resolveLogo('   ')).toBe('')
    expect(resolveLogo({ src: '' })).toBe('')
    expect(resolveLogo({ width: 32 })).toBe('')
  })
})

describe('parseTokenRecord', () => {
  const valid = {
    symbol: 'NANI',
    name: 'NANI',
    address: '0x00000000000007C8612bA63Df8DdEfD9E6077c97',
    decimals: 18,
  }

  it('parses a well-formed record into a chain-tagged token entry', () => {
    expect(parseTokenRecord({ ...valid, logo: { src: 'https://example.com/n.png' } }, 1)).toEqual({
      chainId: 1,
      address: '0x00000000000007C8612bA63Df8DdEfD9E6077c97',
      name: 'NANI',
      symbol: 'NANI',
      decimals: 18,
      logoURI: 'https://example.com/n.png',
    })
  })

  it('rejects a record carrying a non-empty redFlags array', () => {
    // redFlags marks scam or suspicious contracts in the source; such tokens must
    // never be ingested no matter how complete the rest of their metadata is.
    expect(parseTokenRecord({ ...valid, redFlags: ['SCAM'] }, 1)).toBeNull()
  })

  it('ignores an empty redFlags array', () => {
    // An empty array carries no warning, so it must not by itself disqualify a token.
    expect(parseTokenRecord({ ...valid, redFlags: [] }, 1)).not.toBeNull()
  })

  it('accepts decimals of zero but rejects string or absent decimals', () => {
    // decimals: 0 is legitimate (some tokens have none); the source always stores a
    // number, so a string is malformed input and the field being absent is invalid.
    expect(parseTokenRecord({ ...valid, decimals: 0 }, 1)?.decimals).toBe(0)
    expect(parseTokenRecord({ ...valid, decimals: '18' }, 1)).toBeNull()
    expect(parseTokenRecord({ symbol: 'X', name: 'X', address: valid.address }, 1)).toBeNull()
    expect(parseTokenRecord({ ...valid, decimals: Number.NaN }, 1)).toBeNull()
  })

  it('rejects a record missing symbol, name, or address', () => {
    // These three fields are mandatory in the schema; a token without any of them
    // cannot be served, so it is skipped rather than stored half-formed.
    expect(parseTokenRecord({ ...valid, symbol: '' }, 1)).toBeNull()
    expect(parseTokenRecord({ ...valid, name: '   ' }, 1)).toBeNull()
    expect(parseTokenRecord({ symbol: 'X', name: 'X', decimals: 18 }, 1)).toBeNull()
  })

  it('rejects non-object input outright', () => {
    // Token files are external input; a non-object (bad JSON, a bare value) is a skip.
    expect(parseTokenRecord(null, 1)).toBeNull()
    expect(parseTokenRecord('nope', 1)).toBeNull()
    expect(parseTokenRecord(42, 1)).toBeNull()
  })

  it('defaults logoURI to an empty string when no logo is present', () => {
    // A token with no logo still ingests; the empty string signals no image.
    expect(parseTokenRecord(valid, 1)?.logoURI).toBe('')
  })
})

// ---------------------------------------------------------------------------
// EthereumListsCollector — walks the ethereum-lists/tokens submodule on disk.
// ---------------------------------------------------------------------------

const tokensRoot = path.join(paths.submodules, 'ethereum-lists-tokens', 'tokens')
const ethFolder = path.join(tokensRoot, 'eth')
const bscFolder = path.join(tokensRoot, 'bsc')

const buildRecord = (overrides: Record<string, unknown> = {}) => ({
  symbol: 'NANI',
  name: 'Nani Token',
  address: '0x00000000000007c8612ba63df8ddefd9e6077c97',
  decimals: 18,
  logo: { src: 'https://example.com/nani.png' },
  ...overrides,
})

describe('EthereumListsCollector discover', () => {
  it('registers only the on-disk folders present in the authoritative chain-id map', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth', 'bsc', 'not-a-mapped-chain', '.DS_Store'])
    fakeFilesystem.setDirectory(ethFolder, ['0xeth-token.json'])
    fakeFilesystem.setFile(path.join(ethFolder, '0xeth-token.json'), JSON.stringify(buildRecord()))
    fakeFilesystem.setDirectory(bscFolder, ['0xbsc-token.json'])
    fakeFilesystem.setFile(
      path.join(bscFolder, '0xbsc-token.json'),
      JSON.stringify(
        buildRecord({ address: '0x00000000000000000000000000000000000bsc', symbol: 'BSC', name: 'Bsc Token' }),
      ),
    )

    const manifest = await ethereumLists.discover(new AbortController().signal)

    expect(harness.state.providers).toEqual([
      { providerId: 'provider:ethereum-lists', key: 'ethereum-lists', name: 'Ethereum Lists', description: null },
    ])
    expect(manifest).toHaveLength(1)
    expect(manifest[0]?.providerKey).toBe('ethereum-lists')
    // "not-a-mapped-chain" is absent from NETWORK_MAPPING and must never surface as a list.
    expect(manifest[0]?.lists.map((list) => list.listKey).sort()).toEqual(['tokens-bsc', 'tokens-eth'])
    expect(harness.state.lists.map((list) => list.key).sort()).toEqual(['tokens-bsc', 'tokens-eth'])
    // One network for chain 1 (eth), one for chain 56 (bsc), plus the shared default
    // asset-0 network every inmemory-tokenlist.discover() call also creates.
    expect(harness.state.networks.size).toBe(3)
  })

  it('excludes non-json files and skips a file that fails to read, is malformed, or fails validation', async () => {
    const goodPath = path.join(ethFolder, 'good.json')
    const unreadablePath = path.join(ethFolder, 'unreadable.json')
    const malformedPath = path.join(ethFolder, 'malformed.json')
    const invalidPath = path.join(ethFolder, 'invalid.json')
    const readmePath = path.join(ethFolder, 'readme.md')

    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    fakeFilesystem.setDirectory(ethFolder, [
      'good.json',
      'unreadable.json',
      'malformed.json',
      'invalid.json',
      'readme.md',
    ])
    fakeFilesystem.setFile(goodPath, JSON.stringify(buildRecord()))
    // unreadable.json is listed but never registered with setFile, so readFile rejects ENOENT.
    fakeFilesystem.setFile(malformedPath, '{not valid json')
    fakeFilesystem.setFile(invalidPath, JSON.stringify(buildRecord({ name: '' })))

    await ethereumLists.discover(new AbortController().signal)
    await ethereumLists.collect(new AbortController().signal)

    // Only the well-formed, readable, valid record made it through to insertion.
    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0x00000000000007c8612ba63df8ddefd9e6077c97')
    // The non-json file is filtered out before any read is attempted.
    expect(fakeFilesystem.promises.readFile).not.toHaveBeenCalledWith(readmePath, 'utf8')
    expect(fakeFilesystem.promises.readFile).toHaveBeenCalledWith(unreadablePath, 'utf8')
    expect(fakeFilesystem.promises.readFile).toHaveBeenCalledWith(malformedPath, 'utf8')
    expect(fakeFilesystem.promises.readFile).toHaveBeenCalledWith(invalidPath, 'utf8')
  })

  it('logs and skips a mapped folder whose directory cannot be read, without aborting the rest', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth', 'bsc'])
    fakeFilesystem.setDirectory(ethFolder, ['good.json'])
    fakeFilesystem.setFile(path.join(ethFolder, 'good.json'), JSON.stringify(buildRecord()))
    // bsc is a mapped chain and present in the top-level listing, but its own folder
    // was never registered, so `fs.promises.readdir(bscFolder)` rejects.

    const manifest = await ethereumLists.discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['tokens-eth'])
    expect(harness.state.lists.map((list) => list.key)).toEqual(['tokens-eth'])
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('provider=%o'),
      'ethereum-lists',
      'bsc',
      expect.any(String),
    )
  })

  it('stringifies a non-Error value thrown while discovering a network', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    // Register no `ethFolder` directory contents at all, and force the readdir
    // rejection to be a bare string rather than an `Error`, exercising the
    // `String(err)` side of discoverNetwork's `err instanceof Error` check.
    fakeFilesystem.failReaddir(ethFolder, 'disk exploded')

    const manifest = await ethereumLists.discover(new AbortController().signal)

    expect(manifest[0]?.lists).toEqual([])
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('provider=%o'),
      'ethereum-lists',
      'eth',
      'disk exploded',
    )
  })

  it('skips a network whose discovery is aborted mid-flight, without treating it as an error', async () => {
    const controller = new AbortController()
    harness.dbModule.insertNetworkFromChainId.mockImplementationOnce(async (chainId: number, type = 'evm') => {
      controller.abort()
      return { networkId: `network:eip155-${chainId}`, type, chainId: `eip155-${chainId}` }
    })
    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    fakeFilesystem.setDirectory(ethFolder, ['good.json'])
    fakeFilesystem.setFile(path.join(ethFolder, 'good.json'), JSON.stringify(buildRecord()))

    const manifest = await ethereumLists.discover(controller.signal)

    expect(manifest[0]?.lists).toEqual([])
    expect(harness.gibsUtilsModule.failureLog).not.toHaveBeenCalled()
  })
})

describe('EthereumListsCollector collect', () => {
  it('inserts every discovered token across every network', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth', 'bsc'])
    fakeFilesystem.setDirectory(ethFolder, ['0xeth-token.json'])
    fakeFilesystem.setFile(path.join(ethFolder, '0xeth-token.json'), JSON.stringify(buildRecord()))
    fakeFilesystem.setDirectory(bscFolder, ['0xbsc-token.json'])
    fakeFilesystem.setFile(
      path.join(bscFolder, '0xbsc-token.json'),
      JSON.stringify(
        buildRecord({ address: '0x00000000000000000000000000000000000bsc', symbol: 'BSC', name: 'Bsc Token' }),
      ),
    )

    await ethereumLists.discover(new AbortController().signal)
    await ethereumLists.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(2)
  })

  it('stops processing further networks once the signal is already aborted', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    fakeFilesystem.setDirectory(ethFolder, ['good.json'])
    fakeFilesystem.setFile(path.join(ethFolder, 'good.json'), JSON.stringify(buildRecord()))

    await ethereumLists.discover(new AbortController().signal)
    const controller = new AbortController()
    controller.abort()
    await ethereumLists.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('logs and continues past a network whose token processing throws, instead of aborting the run', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    fakeFilesystem.setDirectory(ethFolder, ['good.json'])
    fakeFilesystem.setFile(path.join(ethFolder, 'good.json'), JSON.stringify(buildRecord()))
    await ethereumLists.discover(new AbortController().signal)

    // Force an exception out of inmemory-tokenlist.collect()'s own body (not its
    // per-token try/catch, which never lets a single bad token abort a network) so
    // the outer per-network try/catch in EthereumListsCollector.collectNetwork is
    // the thing actually under test.
    const originalMapToSetToken = harness.utilsModule.mapToSet.token
    harness.utilsModule.mapToSet.token = () => {
      throw new Error('mapToSet failure')
    }
    try {
      await expect(ethereumLists.collect(new AbortController().signal)).resolves.toBeUndefined()
    } finally {
      harness.utilsModule.mapToSet.token = originalMapToSetToken
    }

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('provider=%o'),
      'ethereum-lists',
      'eth',
      expect.any(String),
    )
  })

  it('stringifies a non-Error value thrown while collecting a network', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    fakeFilesystem.setDirectory(ethFolder, ['good.json'])
    fakeFilesystem.setFile(path.join(ethFolder, 'good.json'), JSON.stringify(buildRecord()))
    await ethereumLists.discover(new AbortController().signal)

    // Same seam as the test above, but a bare string this time — exercises the
    // `String(err)` side of collectNetwork's `err instanceof Error` check.
    const originalMapToSetToken = harness.utilsModule.mapToSet.token
    harness.utilsModule.mapToSet.token = () => {
      throw 'mapToSet exploded'
    }
    try {
      await expect(ethereumLists.collect(new AbortController().signal)).resolves.toBeUndefined()
    } finally {
      harness.utilsModule.mapToSet.token = originalMapToSetToken
    }

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('provider=%o'),
      'ethereum-lists',
      'eth',
      'mapToSet exploded',
    )
  })
})

describe('EthereumListsCollector standalone collect()', () => {
  it('runs discover() then collect() against the same collector instance', async () => {
    fakeFilesystem.setDirectory(tokensRoot, ['eth'])
    fakeFilesystem.setDirectory(ethFolder, ['good.json'])
    fakeFilesystem.setFile(path.join(ethFolder, 'good.json'), JSON.stringify(buildRecord()))

    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['ethereum-lists'])
    expect(harness.state.tokenImages).toHaveLength(1)
  })
})
