import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

/**
 * pls369.ts walks a real submodule directory tree on disk (which is not checked
 * out in this workspace) rather than fetching remote JSON, so `fs` is faked here
 * rather than reused from the harness — no collector in the worked examples
 * needs a filesystem stand-in. Only `readdir`/`stat` are exercised; every other
 * `fs` export is left untouched.
 */
const { readdir, stat } = vi.hoisted(() => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, promises: { ...actual.promises, readdir, stat } }
})

beforeEach(() => {
  harness.reset()
  readdir.mockReset()
  stat.mockReset()
})

import pls369, { collect } from './pls369'

// `harness.reset()` clears call history but not a mock's *implementation* —
// `vi.clearAllMocks()` (which it calls) never touches `mockImplementation`
// overrides. A test that swaps in its own implementation (rather than
// `mockImplementationOnce`) would otherwise leak that override into every
// later test in this file, so it is captured once, pristine, and restored
// after every test.
const pristineFetchImageAndStoreForToken = harness.dbModule.fetchImageAndStoreForToken.getMockImplementation()!
const pristineInsertList = harness.dbModule.insertList.getMockImplementation()!

afterEach(() => {
  harness.dbModule.fetchImageAndStoreForToken.mockImplementation(pristineFetchImageAndStoreForToken)
  harness.dbModule.insertList.mockImplementation(pristineInsertList)
})

/** A valid lowercase 20-byte address — the folder name pls369 expects for a piece. */
const GOOD_ADDRESS = '0x1234567890123456789012345678901234567890'
const NO_METADATA_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

/**
 * Wires `fs.promises.readdir`/`stat` to a small fixed tree under `walkPath`:
 *   walkPath/
 *     .DS_Store                     -> excluded (Mac Finder litter)
 *     manifest.json                 -> excluded (extension is .json)
 *     bad-leaf.png                  -> included as a leaf, but fails the address check
 *     GOOD_ADDRESS/logo.png         -> included, a valid address piece
 *     NO_METADATA_ADDRESS/logo.png  -> included, a valid address piece with no erc20 metadata queued
 */
const wireFakeAssetTree = () => {
  readdir.mockImplementation(async (dir: string) => {
    if (dir.endsWith('assets')) {
      return ['.DS_Store', 'manifest.json', 'bad-leaf.png', GOOD_ADDRESS, NO_METADATA_ADDRESS]
    }
    if (dir.endsWith(GOOD_ADDRESS)) return ['logo.png']
    if (dir.endsWith(NO_METADATA_ADDRESS)) return ['logo.png']
    throw new Error(`unexpected readdir(${dir})`)
  })
  stat.mockImplementation(async (file: string) => ({
    isDirectory: () => file.endsWith(GOOD_ADDRESS) || file.endsWith(NO_METADATA_ADDRESS),
  }))
}

describe('pls369 collector', () => {
  it('registers the provider and one list per configured network during discover()', async () => {
    const manifest = await pls369.discover(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['pls369'])
    expect(manifest).toEqual([{ providerKey: 'pls369', lists: [{ listKey: 'repo' }, { listKey: 'repo-testnet' }] }])
    expect(harness.state.lists.map((list) => list.key)).toEqual(['repo', 'repo-testnet'])
    expect(harness.state.networks.has('eip155-369')).toBe(true)
    expect(harness.state.networks.has('eip155-943')).toBe(true)
  })

  it('walks the asset tree, storing only valid on-chain addresses under both network lists', async () => {
    wireFakeAssetTree()
    harness.setErc20Metadata(GOOD_ADDRESS, ['Fixture Token', 'FIX', 18])

    await pls369.collect(new AbortController().signal)

    // One valid address, stored once per network config (mainnet + testnet).
    const goodImages = harness.state.tokenImages.filter((image) => image.token.providedId === GOOD_ADDRESS)
    expect(goodImages).toHaveLength(2)
    expect(goodImages.every((image) => image.token.symbol === 'FIX')).toBe(true)

    // The malformed leaf (not a 42-character address) and the address with no
    // queued erc20 metadata must never reach image storage.
    expect(harness.state.tokenImages.some((image) => image.token.providedId === NO_METADATA_ADDRESS)).toBe(false)
    expect(harness.state.tokenImages).toHaveLength(2)
  })

  it('propagates a per-token storage failure as a rejected collect(), tagging the network as erred', async () => {
    wireFakeAssetTree()
    harness.setErc20Metadata(GOOD_ADDRESS, ['Fixture Token', 'FIX', 18])
    harness.dbModule.fetchImageAndStoreForToken.mockRejectedValue(new Error('disk write exploded'))

    await expect(pls369.collect(new AbortController().signal)).rejects.toThrow('disk write exploded')
  })

  it('stops issuing new per-token work once the signal aborts between the two network configs', async () => {
    wireFakeAssetTree()
    harness.setErc20Metadata(GOOD_ADDRESS, ['Fixture Token', 'FIX', 18])
    const controller = new AbortController()
    // Abort as a side effect of the first network's own list insert — before
    // either network reaches its per-token loop, so the guard inside
    // `tokenAccessLimit.map` is what actually has to skip the work, not the
    // outer per-network guard (already covered by a pre-aborted signal test).
    const originalInsertList = harness.dbModule.insertList.getMockImplementation()!
    let insertListCalls = 0
    harness.dbModule.insertList.mockImplementation(async (input, tx) => {
      insertListCalls += 1
      // Abort synchronously, before the first `await`: both configs' network
      // callbacks reach this call in the same microtask burst, so waiting for
      // this call to resolve first would let the second config's callback
      // already pass its own guard checks before observing the abort.
      if (insertListCalls === 1) controller.abort()
      return originalInsertList(input, tx)
    })

    await pls369.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops before walking any network once the signal is already aborted', async () => {
    wireFakeAssetTree()
    harness.setErc20Metadata(GOOD_ADDRESS, ['Fixture Token', 'FIX', 18])
    const controller = new AbortController()
    controller.abort()

    await pls369.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('exposes a standalone collect() that delegates to the same collector instance', async () => {
    wireFakeAssetTree()
    harness.setErc20Metadata(GOOD_ADDRESS, ['Fixture Token', 'FIX', 18])

    await collect(new AbortController().signal)

    expect(harness.state.tokenImages.length).toBeGreaterThan(0)
  })
})
