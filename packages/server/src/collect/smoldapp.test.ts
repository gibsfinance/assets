import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as paths from '../paths'
import { harness, createFakeTerminalRowProxy } from './__testing__/collector-harness'
import type { InsertableList } from '../db/schema-types'
import { fakeFilesystem } from './__testing__/fake-filesystem'

vi.mock('fs', () => ({ promises: fakeFilesystem.promises }))

// smoldapp.ts calls `db.insertImage`, which the shared harness does not model (no
// other collector under test needs it) — reuse everything else from harness.dbModule
// and record insertImage calls locally. Worth upstreaming a minimal insertImage mock
// into collector-harness.ts if a future collector needs it too.
//
// `vi.mock()` factories are hoisted above every import and top-level `const`, so the
// mock's own supporting state has to be built inside `vi.hoisted()` rather than
// referenced as an ordinary module-level binding (see collector-harness.ts's doc
// comment for the same trap with `vi.hoisted()` vs. lazily-evaluated factories).
export type RecordedInsertedImage = { providerKey: string; originalUri: string; listId: string | null; image: Buffer }
const { insertedImages, insertImage } = vi.hoisted(() => {
  const images: RecordedInsertedImage[] = []
  return {
    insertedImages: images,
    insertImage: vi.fn(async (input: RecordedInsertedImage) => {
      images.push(input)
      return { image: { imageHash: `fake-hash:${input.originalUri}` }, link: { uri: input.originalUri } }
    }),
  }
})
vi.mock('../db', () => ({ ...harness.dbModule, insertImage }))

// smoldapp.ts reads `folderContents` and `commonNativeNames` from `../utils`, neither
// of which the shared harness models (no other collector under test needs them).
// `folderContents` is re-implemented here as a thin wrapper over the same fake
// filesystem `fs.promises.readdir` the collector itself calls, reusing the harness's
// real `removedUndesirable` — so it fails the same way the collector's own calls would
// if the directory-walking logic changed, rather than duplicating behavior blindly.
vi.mock('../utils', () => ({
  ...harness.utilsModule,
  folderContents: async (folder: string) =>
    harness.utilsModule.removedUndesirable(await fakeFilesystem.promises.readdir(folder)),
  commonNativeNames: new Set([
    '0x0000000000000000000000000000000000000000',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  ]),
}))

vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
// smoldapp.ts imports erc20Read from the `/viem` subpath, not the package root the
// harness mocks — reuse the same tracked mock so `harness.setErc20Metadata` still works.
vi.mock('@gibs/utils/viem', () => ({ erc20Read: harness.gibsUtilsModule.erc20Read }))

// `processSmoldappToken` bypasses ../db entirely for its "does this token already
// have metadata" check, going straight to a dynamically-imported `../db/drizzle`
// getDrizzle().select().from().where().limit() chain. None of the other harness-based
// collectors reach into Drizzle directly, so this is modeled locally: a single
// controllable result array standing in for "what the existing-token lookup finds".
type ExistingTokenRow = { name: string; symbol: string; decimals: number }
const existingTokenLookup = vi.hoisted(() => {
  const state: { rows: ExistingTokenRow[] } = { rows: [] }
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => state.rows,
  }
  return { state, selectChain }
})
vi.mock('../db/drizzle', () => ({ getDrizzle: () => ({ select: () => existingTokenLookup.selectChain }) }))

import SmoldappCollector, { collect } from './smoldapp'

const root = path.join(paths.submodules, 'smoldapp-tokenassets')
const tokensPath = path.join(root, 'tokens')
const chainsPath = path.join(root, 'chains')
const listJsonPath = path.join(tokensPath, 'list.json')
const chainFolderPath = (chainId: string) => path.join(chainsPath, chainId)
const chainFilePath = (chainId: string, file: string) => path.join(chainFolderPath(chainId), file)
const tokenFolderPath = (chainIdString: string, token: string) =>
  path.join(tokensPath, chainIdString, token.toLowerCase())
const tokenImagePath = (chainIdString: string, token: string, image: string) =>
  path.join(tokenFolderPath(chainIdString, token), image)

/** A chain id `utils.findChain` is configured (below) to always report as unknown —
 * exercises the "no chain" branches without depending on a real, resolvable chain. */
const UNKNOWN_CHAIN_ID = 999999

beforeEach(() => {
  harness.reset()
  fakeFilesystem.reset()
  insertedImages.length = 0
  existingTokenLookup.state.rows = []
})

// `utils.findChain` is a real `vi.fn()` on the shared harness (unlike the plain
// `mapToSet` functions), so it is safe to give it a persistent custom implementation
// here — `harness.reset()`'s `vi.clearAllMocks()` clears call history, not this.
harness.utilsModule.findChain.mockImplementation((chainId: number) =>
  chainId === UNKNOWN_CHAIN_ID ? null : { id: chainId, name: `fixture-chain-${chainId}` },
)

describe('SmoldappCollector discover', () => {
  it('returns an empty manifest and creates nothing when tokens/list.json is missing', async () => {
    const manifest = await new SmoldappCollector().discover(new AbortController().signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
  })

  it('returns an empty manifest without creating anything when the signal is already aborted', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    const controller = new AbortController()
    controller.abort()

    const manifest = await new SmoldappCollector().discover(controller.signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
  })

  it('registers a provider, per-chain-format lists, and the global format lists, skipping non-chain entries', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1', '_info.json', 'btcm', 'weird.json'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg', 'logo-128.png', 'logo-.png'])

    const manifest = await new SmoldappCollector().discover(new AbortController().signal)

    expect(harness.state.providers).toEqual([
      {
        providerId: 'provider:smoldapp',
        key: 'smoldapp',
        name: 'Smol Dapp',
        description: 'a communitly led initiative to collect all the evm assets',
      },
    ])
    const listKeys = new Set(manifest[0]?.lists.map((list) => list.listKey))
    expect(listKeys).toEqual(
      new Set([
        'tokens-1-svg',
        'tokens-1-png128',
        'tokens-1-png',
        'tokens-svg',
        'tokens-png',
        'tokens-png128',
        'tokens-png32',
      ]),
    )
    expect(harness.state.networks.get('eip155-1')).toBeDefined()
  })

  it('stops before creating anything once the signal aborts while listing chain folders', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    const controller = new AbortController()
    fakeFilesystem.promises.readdir.mockImplementationOnce(async () => {
      controller.abort()
      return ['1']
    })

    const manifest = await new SmoldappCollector().discover(controller.signal)

    // An abort mid-walk bails out of discover() entirely — a bare empty array, not
    // a manifest shape, since the provider/list bookkeeping never gets to complete.
    expect(manifest).toEqual([])
  })

  it('stops mid-chain once the signal aborts while listing that chain’s own files', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    const controller = new AbortController()
    harness.dbModule.insertNetworkFromChainId.mockImplementationOnce(async (chainId: number, type = 'evm') => {
      controller.abort()
      return { networkId: `network:eip155-${chainId}`, type, chainId: `eip155-${chainId}` }
    })

    const manifest = await new SmoldappCollector().discover(controller.signal)

    expect(manifest).toEqual([])
  })

  it('stops before starting a second chain once the signal aborts between chains', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1', '2'])
    // Chain "1" has no files of its own, so its (empty) file loop never gets a
    // chance to observe the abort itself — only the outer per-chain loop's own
    // top-of-iteration check, on chain "2", can catch it.
    fakeFilesystem.setDirectory(chainFolderPath('1'), [])
    const controller = new AbortController()
    harness.dbModule.insertNetworkFromChainId.mockImplementationOnce(async (chainId: number, type = 'evm') => {
      controller.abort()
      return { networkId: `network:eip155-${chainId}`, type, chainId: `eip155-${chainId}` }
    })

    const manifest = await new SmoldappCollector().discover(controller.signal)

    expect(manifest).toEqual([])
  })

  it('drops a global format list when inserting it fails, but keeps the others', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, [])
    harness.dbModule.insertList.mockImplementationOnce(async () => {
      throw new Error('insert failed')
    })

    const manifest = await new SmoldappCollector().discover(new AbortController().signal)

    const listKeys = manifest[0]?.lists.map((list) => list.listKey)
    // "tokens-svg" is the first of the four global keys attempted — it is the one
    // whose insert was made to fail, so it alone must be missing from the manifest.
    expect(listKeys).toEqual(['tokens-png', 'tokens-png128', 'tokens-png32'])
  })
})

describe('SmoldappCollector collect — chain images', () => {
  it('does nothing when discover() was never run (no info loaded)', async () => {
    await new SmoldappCollector().collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(insertedImages).toHaveLength(0)
  })

  it('stores an svg chain logo against both the network and its list via one transaction', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo.svg'), '<svg/>')

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(1)
    expect(harness.state.networkImages[0]?.uri).toBe(chainFilePath('1', 'logo.svg'))
    expect(harness.state.listImages).toHaveLength(1)
  })

  it('fetches, stores, and inserts a non-svg chain logo', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo-128.png'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo-128.png'), 'png-bytes')

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.listImages).toHaveLength(1)
    expect(harness.state.listImages[0]?.uri).not.toBeNull()
    expect(insertedImages).toHaveLength(1)
    expect(insertedImages[0]?.originalUri).toBe(chainFilePath('1', 'logo-128.png'))
  })

  it('never calls insertImage, and never records a list image, when the non-svg chain logo fetch fails', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo-32.png'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo-32.png'), 'png-bytes')
    harness.failImageFetch(chainFilePath('1', 'logo-32.png'))

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    // A null uri is never persisted as a list image (see collector-harness.ts's
    // fetchImageAndStoreForList mock), and insertImage is explicitly skipped by
    // the collector itself (`if (!img) return`) — both must stay empty.
    expect(harness.state.listImages).toHaveLength(0)
    expect(insertedImages).toHaveLength(0)
  })

  it('skips a json/dotfile/non-numeric entry with a skip counter, and a file whose list was never discovered', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1', '_info.json', 'btcm', 'weird.json'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    // A second file appears on disk only after discover() already ran — collect()
    // re-reads the same directory and finds a listKey discover() never registered.
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg', 'logo-32.png'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo.svg'), '<svg/>')
    fakeFilesystem.setFile(chainFilePath('1', 'logo-32.png'), 'png-bytes')

    await collector.collect(new AbortController().signal)

    // Only the svg file (whose list discover() actually created) produced a network image.
    expect(harness.state.networkImages).toHaveLength(1)
  })

  it('falls back to parsing the folder name itself for a chain discover() never saw', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), [])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    // A brand new chain folder appears only once collect() re-lists chainsPath —
    // `folderToNetworkChainId` was never populated for it during discover(), so its
    // network chain id has to be parsed straight from the folder name instead.
    fakeFilesystem.setDirectory(chainsPath, ['1', '2'])
    fakeFilesystem.setDirectory(chainFolderPath('2'), ['logo.svg'])
    fakeFilesystem.setFile(chainFilePath('2', 'logo.svg'), '<svg/>')

    await collector.collect(new AbortController().signal)

    expect(harness.state.networks.get('eip155-2')).toBeDefined()
  })

  it('stops before processing chain images once the signal aborts while re-listing chain folders', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo.svg'), '<svg/>')

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)

    const controller = new AbortController()
    controller.abort()
    await collector.collect(controller.signal)

    expect(harness.state.networkImages).toHaveLength(0)
  })

  it('stops mid-chain once the signal aborts while re-listing a chain’s own files', async () => {
    fakeFilesystem.setFile(listJsonPath, JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: {} }))
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo.svg'), '<svg/>')

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)

    const controller = new AbortController()
    harness.dbModule.insertNetworkFromChainId.mockImplementationOnce(async (chainId: number, type = 'evm') => {
      controller.abort()
      return { networkId: `network:eip155-${chainId}`, type, chainId: `eip155-${chainId}` }
    })
    await collector.collect(controller.signal)

    expect(harness.state.networkImages).toHaveLength(0)
  })
})

describe('SmoldappCollector collect — tokens', () => {
  const setupOneChainWithSvgFormat = () => {
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo.svg'), '<svg/>')
  }

  it('stops before token processing once the signal is already aborted and there are no chains to walk', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenUnreached'] } }),
    )
    fakeFilesystem.setDirectory(chainsPath, [])
    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)

    const controller = new AbortController()
    controller.abort()
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops before the token-counting loop once the signal aborts right after the chain-image walk', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenUnreached2'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenUnreached2'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenUnreached2', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtokenunreached2', ['Unreached', 'UNRCH', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)

    const controller = new AbortController()
    // `row.issue(providerKey)` is the very next call after the chain-image walk
    // finishes and before the token-counting loop starts — aborting there isolates
    // this specific guard from the earlier per-chain-loop abort check.
    harness.utilsModule.terminal.issue.mockImplementationOnce(() => {
      const row = createFakeTerminalRowProxy()
      row.issue = vi.fn(() => {
        controller.abort()
        return { ...harness.utilsModule.terminal }
      })
      return row
    })
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops before starting a chain’s per-token work once the signal aborts right after the counting loop', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenUnreached3'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenUnreached3'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenUnreached3', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtokenunreached3', ['Unreached', 'UNRCH', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)

    const controller = new AbortController()
    // `row.incrementTotal` is called once for the NETWORK counter (before the
    // counting loop) and once per surviving chain entry inside it (the TOKEN
    // counter, for chain "1" — the only entry here). Aborting on that second call
    // lets the counting loop finish normally, isolating `networkLimiter.map`'s own
    // abort guard from the earlier one inside the counting loop itself.
    harness.utilsModule.terminal.issue.mockImplementationOnce(() => {
      const row = createFakeTerminalRowProxy()
      let incrementTotalCalls = 0
      row.incrementTotal = vi.fn(() => {
        incrementTotalCalls += 1
        if (incrementTotalCalls === 2) controller.abort()
      })
      return row
    })
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('inserts a token image discovered via erc20Read, into both its format list and its network list', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken1'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken1'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xToken1', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtoken1', ['Token One', 'TOK1', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages.length).toBeGreaterThanOrEqual(2)
    for (const image of harness.state.tokenImages) {
      expect(image.token.providedId).toBe('0xtoken1')
      expect(image.token.symbol).toBe('TOK1')
    }
  })

  it('reuses an existing token’s stored metadata instead of calling erc20Read', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken2'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken2'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xToken2', 'icon.svg'), 'token-svg-bytes')
    existingTokenLookup.state.rows = [{ name: 'Existing Token', symbol: 'EXIST', decimals: 6 }]

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.gibsUtilsModule.erc20Read).not.toHaveBeenCalled()
    expect(harness.state.tokenImages[0]?.token.symbol).toBe('EXIST')
    expect(harness.state.tokenImages[0]?.token.decimals).toBe(6)
  })

  it('normalizes a common native-currency placeholder address to the zero address', async () => {
    const nativePlaceholder = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': [nativePlaceholder] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', nativePlaceholder), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', nativePlaceholder, 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0x0000000000000000000000000000000000000000', ['Native', 'NATIVE', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0x0000000000000000000000000000000000000000')
  })

  it('skips a chain unknown to findChain in the progress counter, but still processes its tokens', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({
        version: { major: 1, minor: 0, patch: 0 },
        tokens: { [`${UNKNOWN_CHAIN_ID}`]: ['0xToken3'] },
      }),
    )
    fakeFilesystem.setDirectory(chainsPath, [])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    // findChain(999999) reports unknown, so processSmoldappToken's own findChain
    // guard silently drops the token — no image is ever recorded for it, and no
    // error is raised either.
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips a non-numeric chain key in the tokens map entirely', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { solana: ['abcXYZ'] } }),
    )
    fakeFilesystem.setDirectory(chainsPath, [])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('abandons an entire chain’s tokens when its list cache fails to build', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken4'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken4'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xToken4', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtoken4', ['Token Four', 'TOK4', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    // discover() already created the svg list; force the *next* possibleListKeys
    // insert (one of png/png128/png32, none of which discover() created for this
    // chain) to reject, which must abandon token processing for the whole chain.
    harness.dbModule.insertList.mockImplementationOnce(async () => {
      throw new Error('list insert failed')
    })
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('network list cache'),
      '1',
      expect.anything(),
    )
  })

  it('skips a token whose erc20Read call fails', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken5'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken5'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xToken5', 'icon.svg'), 'token-svg-bytes')
    // No erc20Metadata queued for 0xtoken5 — harness's erc20Read mock rejects.

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips a token whose image folder cannot be read', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken6'] } }),
    )
    setupOneChainWithSvgFormat()
    // No tokenFolderPath('1', '0xToken6') directory registered — readdir rejects.
    harness.setErc20Metadata('0xtoken6', ['Token Six', 'TOK6', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips a token with an empty image folder', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken7'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken7'), [])
    harness.setErc20Metadata('0xtoken7', ['Token Seven', 'TOK7', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips a token whose first image format was never cached for its chain', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken8'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken8'), ['icon.weird'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xToken8', 'icon.weird'), 'token-bytes')
    harness.setErc20Metadata('0xtoken8', ['Token Eight', 'TOK8', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('Network list not found'),
      expect.anything(),
      '1',
    )
  })

  it('skips a single image whose own list insert fails, without dropping the whole token', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xToken9'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xToken9'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xToken9', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtoken9', ['Token Nine', 'TOK9', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    // discover() already made its own "tokens-svg" call (the global format-list
    // pre-creation) using the harness's default implementation, above. Installing
    // this override only now means the *next* "tokens-svg" request it sees is
    // necessarily processSmoldappToken's own per-image insert — the one this test
    // targets — never the earlier, unrelated global-list insert.
    const realInsertList = harness.dbModule.insertList.getMockImplementation()!
    harness.dbModule.insertList.mockImplementation(async (list: InsertableList, tx) => {
      if (list.key === 'tokens-svg') {
        throw new Error('per-image list insert failed')
      }
      return realInsertList(list, tx)
    })
    try {
      await collector.collect(new AbortController().signal)
    } finally {
      // `mockImplementation` (unlike `mockImplementationOnce`) persists across
      // `harness.reset()`, which only clears call history — restore it explicitly
      // so later tests in this file see the harness's normal insertList behavior.
      harness.dbModule.insertList.mockImplementation(realInsertList)
    }

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('bails out of per-image processing once the signal aborts partway through a token’s images', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenMulti'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenMulti'), ['icon.svg', 'icon-2.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenMulti', 'icon.svg'), 'token-svg-bytes')
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenMulti', 'icon-2.svg'), 'token-svg-bytes-2')
    harness.setErc20Metadata('0xtokenmulti', ['Token Multi', 'MULTI', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    const controller = new AbortController()
    // Abort as a side effect of storing the *first* image, so the second image in
    // the same token's loop observes the signal already aborted.
    harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async (input) => {
      controller.abort()
      harness.state.tokenImages.push({
        providerKey: input.providerKey,
        listId: input.listId,
        listTokenOrderId: input.listTokenOrderId,
        uri: input.uri,
        originalUri: input.originalUri,
        token: input.token,
      })
      return undefined
    })
    await collector.collect(controller.signal)

    // The abort surfaces as a thrown error from inside processSmoldappToken, caught
    // by the per-token try/catch, which logs and marks the token as skipped instead
    // of leaving the run to crash — the "aborted" token still doesn't fully insert.
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      '%s token %o on chain %o: %o',
      'error',
      '0xTokenMulti',
      '1',
      'aborted',
    )
  })

  it("labels a per-token failure 'timeout' when the per-token timeout signal is the one that fired", async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenTimeout'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenTimeout'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenTimeout', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtokentimeout', ['Token Timeout', 'TIMEOUT', 18])

    // The `isTimeout` label reads `tokenSignal.aborted`, where `tokenSignal` is
    // exactly what `AbortSignal.timeout(3_000)` returns — stub that global to
    // hand back an already-aborted signal instead of a real three-second timer,
    // so the per-image loop's own `if (signal.aborted) throw ...` fires with no
    // wall-clock wait, and the failure is attributable to `tokenSignal` alone
    // (the caller's own signal here never aborts).
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      controller.abort()
      return controller.signal
    })

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    try {
      await collector.collect(new AbortController().signal)
    } finally {
      timeoutSpy.mockRestore()
    }

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      '%s token %o on chain %o: %o',
      'timeout',
      '0xTokenTimeout',
      '1',
      'aborted',
    )
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('logs and skips a token whose storage transaction throws, without aborting the run', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenThrows'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenThrows'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenThrows', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtokenthrows', ['Token Throws', 'THROWS', 18])
    harness.dbModule.fetchImageAndStoreForToken.mockImplementationOnce(async () => {
      throw new Error('storage failure')
    })

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      '%s token %o on chain %o: %o',
      'error',
      '0xTokenThrows',
      '1',
      'storage failure',
    )
  })

  it('stops before a second token once the signal aborts partway through the token loop', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenB1', '0xTokenB2'] } }),
    )
    setupOneChainWithSvgFormat()
    for (const token of ['0xTokenB1', '0xTokenB2']) {
      fakeFilesystem.setDirectory(tokenFolderPath('1', token), ['icon.svg'])
      fakeFilesystem.setFile(tokenImagePath('1', token, 'icon.svg'), 'token-svg-bytes')
      harness.setErc20Metadata(token.toLowerCase(), [`Token ${token}`, token.toUpperCase(), 18])
    }
    const controller = new AbortController()
    harness.utilsModule.terminal.issue.mockImplementationOnce(() => {
      const row = createFakeTerminalRowProxy()
      const originalIssue = row.issue.getMockImplementation()!
      // `section.task(...)` is called once per token, right before the token's own
      // work begins — aborting here, on the very first token, makes the guard at the
      // top of the *next* token's callback see the signal already aborted. Parallel
      // dispatch (`tokenLimit.map`) still runs each callback synchronously up to its
      // first `await`, so this ordering is deterministic, not a race.
      row.issue = vi.fn((...args: Parameters<typeof originalIssue>) => {
        const section = originalIssue(...args)
        section.task = vi.fn(() => {
          controller.abort()
          return { ...createFakeTerminalRowProxy(), unmount: vi.fn() }
        })
        return section
      })
      return row
    })

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops processing tokens once the signal is already aborted', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenA'] } }),
    )
    setupOneChainWithSvgFormat()
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenA'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenA', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtokena', ['Token Ten', 'TOKA', 18])

    const collector = new SmoldappCollector()
    await collector.discover(new AbortController().signal)
    const controller = new AbortController()
    controller.abort()
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })
})

describe('SmoldappCollector standalone collect()', () => {
  it('runs discover() then collect() against a fresh collector instance', async () => {
    fakeFilesystem.setFile(
      listJsonPath,
      JSON.stringify({ version: { major: 1, minor: 0, patch: 0 }, tokens: { '1': ['0xTokenB'] } }),
    )
    fakeFilesystem.setDirectory(chainsPath, ['1'])
    fakeFilesystem.setDirectory(chainFolderPath('1'), ['logo.svg'])
    fakeFilesystem.setFile(chainFilePath('1', 'logo.svg'), '<svg/>')
    fakeFilesystem.setDirectory(tokenFolderPath('1', '0xTokenB'), ['icon.svg'])
    fakeFilesystem.setFile(tokenImagePath('1', '0xTokenB', 'icon.svg'), 'token-svg-bytes')
    harness.setErc20Metadata('0xtokenb', ['Token Eleven', 'TOKB', 18])

    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['smoldapp'])
    expect(harness.state.tokenImages.length).toBeGreaterThanOrEqual(2)
  })
})
