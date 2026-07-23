import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as paths from '../paths'
import { harness, createFakeTerminalRowProxy } from './__testing__/collector-harness'
import { fakeFilesystem } from './__testing__/fake-filesystem'
import { terminalLogTypes } from '../log/types'

// trustwallet imports ../utils, which instantiates the Ink terminal renderer at
// module load and cannot run under vitest, so ../utils is fully mocked (as the
// harness doc comment recommends) rather than partially stubbed.
vi.mock('fs', () => ({ promises: fakeFilesystem.promises }))
vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
// See ethereum-lists.test.ts for why the harness's `limitBy` mock (a bare async
// function) cannot stand in here: trustwallet.ts calls `limitBy(key, count).map(...)`,
// which needs a `.map` method the harness mock does not have.
vi.mock('@gibs/utils', () => ({
  ...harness.gibsUtilsModule,
  limitBy: <T>(_key: string, _count = 16) => ({
    map: async (items: T[], fn: (item: T) => Promise<unknown>) => Promise.all(items.map(fn)),
  }),
}))

const blockchainsRoot = path.join(paths.submodules, 'trustwallet', 'blockchains')
const folderPath = (key: string) => path.join(blockchainsRoot, key)
const infoJsonPath = (key: string) => path.join(folderPath(key), 'info', 'info.json')
const logoPngPath = (key: string) => path.join(folderPath(key), 'info', 'logo.png')
const tokenlistJsonPath = (key: string) => path.join(folderPath(key), 'tokenlist.json')
const assetsFolderPath = (key: string) => path.join(folderPath(key), 'assets')
const assetInfoJsonPath = (key: string, asset: string) => path.join(assetsFolderPath(key), asset, 'info.json')
const assetLogoPngPath = (key: string, asset: string) => path.join(assetsFolderPath(key), asset, 'logo.png')

/** Registers a minimally valid `info/info.json` for a blockchain folder, so
 * `loadChainId()` (which reads it unconditionally, before even checking the
 * hardcoded override map) never fails for a folder the test does not care about. */
const setInfoJson = (key: string, overrides: Record<string, unknown> = {}) => {
  fakeFilesystem.setFile(infoJsonPath(key), JSON.stringify({ name: key, symbol: key.toUpperCase(), ...overrides }))
}

const CHAINLIST_URL = 'https://chainlist.org/rpcs.json'

type FakeChainListEntry = {
  name: string
  chain: string
  chainSlug: string
  chainId: number
  faucets?: string[]
  rpc?: { url: string; tracking: string }[]
  nativeCurrency?: { name: string; symbol: string; decimals: number }
  slip44?: number
  networkId?: number
}

let chainListEntries: FakeChainListEntry[] = []
/** url -> hex chain id the mocked json-rpc `eth_chainId` call should resolve to, or 'error' to fail it. */
let rpcChainIdResults = new Map<string, string>()
let chainListResponseStatus = 200

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

// viem's http transport normalizes a bare-origin RPC url by appending a trailing
// slash before it ever reaches `fetch`, so a fixture registered without one would
// never match — strip it on both sides to compare on equal footing.
const withoutTrailingSlash = (value: string): string => value.replace(/\/$/, '')

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input)
  if (url === CHAINLIST_URL) {
    if (chainListResponseStatus !== 200) {
      return new Response('server error', { status: chainListResponseStatus, statusText: 'Internal Server Error' })
    }
    return new Response(JSON.stringify(chainListEntries), { status: 200 })
  }
  const result = rpcChainIdResults.get(withoutTrailingSlash(url))
  if (result === 'error') {
    throw new Error(`collector-harness: simulated network failure for ${url}`)
  }
  if (result) {
    const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)
    const body = rawBody ? (JSON.parse(rawBody as string) as { id: number }) : { id: 1 }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { status: 200 })
  }
  throw new Error(`trustwallet.test.ts: unexpected fetch to "${url}" — register a response before calling collect()`)
})

// The shared harness's `terminal.get(id)` mock always returns `null` — a fine stand-in
// for the common `utils.terminal.get(id) ?? utils.terminal.issue(...)` fallback
// pattern most collectors use, but trustwallet.ts's `entriesFromAssets()` genuinely
// depends on retrieving the *same* row `collect()` already issued for `providerKey`
// via `utils.terminal.get(providerKey)`, called from a standalone function that is
// never handed the row directly. Registering issued rows by id here — worth
// upstreaming into collector-harness.ts's terminal proxies — makes `get()` findable.
const terminalRowsById = new Map<string, ReturnType<typeof createFakeTerminalRowProxy>>()
harness.utilsModule.terminal.issue.mockImplementation((options: { id: string }) => {
  const row = createFakeTerminalRowProxy()
  terminalRowsById.set(options.id, row)
  return row
})
harness.utilsModule.terminal.get.mockImplementation((id: string) => terminalRowsById.get(id) ?? null)

beforeEach(() => {
  harness.reset()
  fakeFilesystem.reset()
  vi.resetModules()
  terminalRowsById.clear()
  chainListEntries = []
  chainListResponseStatus = 200
  rpcChainIdResults = new Map()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  // The Trust Wallet fallback path (own tokenlist.json missing) always re-reads
  // `blockchains/ethereum/tokenlist.json` — register it once, for every test, since
  // any folder can hit that fallback depending on what the test registers for itself.
  fakeFilesystem.setFile(
    tokenlistJsonPath('ethereum'),
    JSON.stringify({ name: 'Trust Wallet', timestamp: new Date(0).toISOString(), tokens: [{ chainId: 1 }] }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** `getChainListResult`/`getClient` are module-scope `lodash.memoize`d, so every
 * test needs its own fresh module instance — otherwise the first test to resolve
 * (or reject) the chainlist fetch would poison every later test in the file. */
const importTrustWallet = () => import('./trustwallet')

describe('TrustWalletCollector discover — chain id resolution', () => {
  it('resolves a folder via the hardcoded override map without ever calling chainlist.org', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-smartchain'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves via an exact chainlist chainSlug match', async () => {
    setInfoJson('exactmatch')
    fakeFilesystem.setDirectory(blockchainsRoot, ['exactmatch'])
    chainListEntries = [
      { name: 'Exact Match Chain', chain: 'Exact', chainSlug: 'exactmatch', chainId: 999 },
      { name: 'Unrelated Chain', chain: 'Unrelated', chainSlug: 'unrelated', chainId: 1 },
    ]

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-exactmatch'])
    expect(harness.state.networks.get('eip155-999')).toBeDefined()
  })

  it('falls back to matching the chainlist `chain` field, then prefers a non-testnet candidate', async () => {
    setInfoJson('baz')
    fakeFilesystem.setDirectory(blockchainsRoot, ['baz'])
    // Neither chainSlug nor name sterilizes to "baz", so the slug/name filter is
    // empty and the collector must fall back to matching the `chain` field. Once
    // there, name/chainSlug inclusion also both miss ("baz" appears in neither),
    // so the tiebreaker that prefers a non-testnet/devnet candidate is what picks it.
    chainListEntries = [{ name: 'Something Else Entirely', chain: 'Baz', chainSlug: 'xyz123', chainId: 4242 }]

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-baz'])
    expect(harness.state.networks.get('eip155-4242')).toBeDefined()
  })

  it('falls back to the first candidate when every chain-field match is a testnet/devnet', async () => {
    setInfoJson('qux')
    fakeFilesystem.setDirectory(blockchainsRoot, ['qux'])
    chainListEntries = [{ name: 'Some Testnet Thing', chain: 'Qux', chainSlug: 'unrelated-slug', chainId: 5151 }]

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-qux'])
    expect(harness.state.networks.get('eip155-5151')).toBeDefined()
  })

  it('reads the coin_type from its own tokenlist.json when nothing in chainlist matches', async () => {
    setInfoJson('ownlist', { coin_type: 7777 })
    fakeFilesystem.setDirectory(blockchainsRoot, ['ownlist'])
    fakeFilesystem.setFile(tokenlistJsonPath('ownlist'), JSON.stringify({ name: 'Own List', tokens: [] }))
    // chainListEntries stays empty — no chainlist candidate at all.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-ownlist'])
    expect(harness.state.networks.get('eip155-7777')).toBeDefined()
  })

  it("reads a token entry's chainId from its own tokenlist.json when coin_type is absent", async () => {
    setInfoJson('tokenlistchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['tokenlistchain'])
    fakeFilesystem.setFile(
      tokenlistJsonPath('tokenlistchain'),
      JSON.stringify({ name: 'Token List Chain', tokens: [{ chainId: 8888 }] }),
    )

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-tokenlistchain'])
    expect(harness.state.networks.get('eip155-8888')).toBeDefined()
  })

  it("falls back to the ethereum folder's tokenlist.json (emptied and renamed) when its own is missing", async () => {
    setInfoJson('missinglist', { coin_type: 6161 })
    fakeFilesystem.setDirectory(blockchainsRoot, ['missinglist'])
    // No tokenlistJsonPath('missinglist') registered — readFile rejects, forcing the
    // fallback read of blockchains/ethereum/tokenlist.json registered in beforeEach.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-missinglist'])
    expect(harness.state.networks.get('eip155-6161')).toBeDefined()
  })

  it('increments the error counter and returns instead of throwing when neither its own nor the ethereum fallback tokenlist can be read', async () => {
    setInfoJson('missingboth')
    fakeFilesystem.setDirectory(blockchainsRoot, ['missingboth'])
    // No tokenlistJsonPath('missingboth') registered, so the own-tokenlist read
    // rejects. Force the ethereum fallback that beforeEach registers for every
    // test to reject too, so both signals are silent and the restored guard
    // clause is the only thing left standing between this folder and a throw.
    fakeFilesystem.failReadFile(tokenlistJsonPath('ethereum'))
    // Register the row `loadChainId` retrieves via `utils.terminal.get(providerKey)`
    // ahead of time (mirroring what `collect()` normally does), so the assertion
    // below can distinguish "the guard clause ran" from "an uncaught rejection was
    // silently swallowed by discover()'s own aggregate `.catch()` instead" — both
    // leave the folder out of the manifest, but only the guard clause increments.
    const row = harness.utilsModule.terminal.issue({ id: 'trustwallet' })

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet'])
    expect(row.increment).toHaveBeenCalledWith(terminalLogTypes.EROR, 'trustwallet-missingboth')
    // A restored guard clause returns gracefully — no exception ever reaches
    // discover()'s aggregate `Promise.all(...).catch()`, so it never logs.
    expect(harness.gibsUtilsModule.failureLog).not.toHaveBeenCalled()
  })

  it('resolves via an RPC eth_chainId call when chainlist and both tokenlists are silent', async () => {
    setInfoJson('rpcresolved', { rpc_url: 'https://rpc.rpcresolved.example' })
    fakeFilesystem.setDirectory(blockchainsRoot, ['rpcresolved'])
    // No own tokenlist.json — falls to the emptied ethereum tokenlist.json, which
    // carries no coin_type and no tokens, so chain id resolution reaches the RPC step.
    rpcChainIdResults.set('https://rpc.rpcresolved.example', '0x3039') // 12345

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-rpcresolved'])
    expect(harness.state.networks.get('eip155-12345')).toBeDefined()
  })

  it('gives up on a folder whose RPC call fails and every other signal is silent', async () => {
    setInfoJson('rpcfails', { rpc_url: 'https://rpc.rpcfails.example' })
    fakeFilesystem.setDirectory(blockchainsRoot, ['rpcfails'])
    rpcChainIdResults.set('https://rpc.rpcfails.example', 'error')

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    // Unresolved — the folder never gets a network/list of its own.
    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet'])
  })

  it('gives up on a folder with no override, no chainlist match, no tokenlist chain id, and no rpc_url', async () => {
    setInfoJson('nosignal')
    fakeFilesystem.setDirectory(blockchainsRoot, ['nosignal'])

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet'])
  })

  it('substitutes the known-unreliable Fantom default RPC for a working mirror before calling it', async () => {
    setInfoJson('fantomrpc', { rpc_url: 'https://rpc.ftm.tools' })
    fakeFilesystem.setDirectory(blockchainsRoot, ['fantomrpc'])
    rpcChainIdResults.set('https://1rpc.io/ftm', '0xfa') // 250

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-fantomrpc'])
    expect(harness.state.networks.get('eip155-250')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalledWith('https://rpc.ftm.tools/', expect.anything())
  })

  it('logs and gives up on every folder when the chainlist.org fetch itself fails', async () => {
    setInfoJson('needschainlist')
    fakeFilesystem.setDirectory(blockchainsRoot, ['needschainlist'])
    chainListResponseStatus = 500

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet'])
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalled()
  })

  it('logs and skips a folder whose info.json cannot be read, without losing its healthy siblings', async () => {
    // "broken" carries no info.json at all — `load()` throws inside `loadChainId`,
    // rejecting that folder's promise in the `Promise.all`. The other, healthy folder's
    // side effects (populating `networkNameToChainId`) already happened by then, and
    // the aggregate `.catch()` around `Promise.all` swallows the rejection either way.
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['broken', 'smartchain'])

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet', 'wallet-smartchain'])
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalled()
  })
})

describe('TrustWalletCollector discover — non-Ethereum-Virtual-Machine folders', () => {
  it('routes solana and tron folders to their coin-type network identifiers', async () => {
    setInfoJson('solana')
    setInfoJson('tron')
    fakeFilesystem.setDirectory(blockchainsRoot, ['solana', 'tron'])

    const { default: TrustWalletCollector } = await importTrustWallet()
    const manifest = await new TrustWalletCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey).sort()).toEqual(['wallet', 'wallet-solana', 'wallet-tron'])
    expect(harness.state.networks.get('solana-501')).toBeDefined()
    expect(harness.state.networks.get('tvm-195')).toBeDefined()
  })
})

describe('TrustWalletCollector collect', () => {
  it('inserts a token image for a well-formed asset into both the wallet list and its network list', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setFile(logoPngPath('smartchain'), 'network-logo-bytes')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xAsset1'])
    fakeFilesystem.setFile(
      assetInfoJsonPath('smartchain', '0xAsset1'),
      JSON.stringify({ name: 'Asset One', symbol: 'AST1', decimals: 18 }),
    )
    fakeFilesystem.setFile(assetLogoPngPath('smartchain', '0xAsset1'), 'asset-logo-bytes')

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(2)
    const listIds = new Set(harness.state.tokenImages.map((image) => image.listId))
    expect(listIds.size).toBe(2) // one row for the network-specific list, one for the shared wallet list
    for (const image of harness.state.tokenImages) {
      // "0xAsset1" is not a valid hex address (contains non-hex characters), so
      // normalizeProvidedId's EVM-only lowercasing must leave it exactly as-is.
      expect(image.token.providedId).toBe('0xAsset1')
      expect(image.token.symbol).toBe('AST1')
    }
    expect(harness.state.networkImages).toHaveLength(1)
    expect(harness.state.listImages).toHaveLength(1)
  })

  it('skips an asset folder whose info.json is unreadable', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xBroken'])
    // No info.json registered for 0xBroken — load() rejects, entry is skipped.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips an asset whose logo.png is missing', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xNoLogo'])
    fakeFilesystem.setFile(
      assetInfoJsonPath('smartchain', '0xNoLogo'),
      JSON.stringify({ name: 'No Logo', symbol: 'NOLOGO', decimals: 18 }),
    )
    // No logo.png registered for 0xNoLogo.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips an asset whose image fetch fails', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xFailsFetch'])
    fakeFilesystem.setFile(
      assetInfoJsonPath('smartchain', '0xFailsFetch'),
      JSON.stringify({ name: 'Fails Fetch', symbol: 'FAILS', decimals: 18 }),
    )
    fakeFilesystem.setFile(assetLogoPngPath('smartchain', '0xFailsFetch'), 'asset-logo-bytes')
    harness.failImageFetch(assetLogoPngPath('smartchain', '0xFailsFetch'))

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('does not store a network logo or list image when the network logo.png is missing', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), [])
    // No logo.png registered under smartchain/info/.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.networkImages).toHaveLength(0)
    expect(harness.state.listImages).toHaveLength(0)
  })

  it('skips a folder whose chain id was never resolved, without erroring', async () => {
    setInfoJson('unresolved')
    fakeFilesystem.setDirectory(blockchainsRoot, ['unresolved'])
    // No override, no chainlist match, no tokenlist chain id, no rpc_url — chain id
    // never lands in networkNameToChainId, so collect() must skip this folder outright.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('logs and continues past a folder whose asset directory read rejects unexpectedly', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    // fs.promises.readdir(assets folder) is wrapped in `.catch(() => [])` by the
    // collector itself, so a bare missing directory alone would resolve to `[]`
    // silently. To exercise the outer try/catch in collect()'s per-folder loop,
    // make `entriesFromAssets` itself throw by leaving its own info.json unreadable.
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), [])

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    // discover() must read info.json successfully first, to resolve smartchain's
    // chain id via the override map; only collect()'s later re-read (via
    // entriesFromAssets -> load()) should see the forced failure below.
    await collector.discover(new AbortController().signal)
    fakeFilesystem.failReadFile(infoJsonPath('smartchain'))
    await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalled()
  })

  it('stringifies a non-Error value thrown while processing a folder’s assets', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), [])

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    // The next `db.insertProvider` call belongs to `entriesFromAssets` inside
    // `collect()`'s per-folder try/catch — throwing a bare string (not an `Error`)
    // exercises the `String(err)` side of that catch's `err instanceof Error` check.
    harness.dbModule.insertProvider.mockImplementationOnce(() => {
      throw 'boom'
    })
    await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      expect.stringContaining('provider=%o'),
      'trustwallet',
      'smartchain',
      'boom',
    )
  })

  it("treats a missing assets directory the same as an empty one, via readdir's own catch", async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    // No assetsFolderPath('smartchain') directory registered at all — readdir rejects.

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('bails out of per-asset processing once the signal aborts before the loop starts', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setFile(logoPngPath('smartchain'), 'network-logo-bytes')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xAsset1'])
    fakeFilesystem.setFile(
      assetInfoJsonPath('smartchain', '0xAsset1'),
      JSON.stringify({ name: 'Asset One', symbol: 'AST1', decimals: 18 }),
    )
    fakeFilesystem.setFile(assetLogoPngPath('smartchain', '0xAsset1'), 'asset-logo-bytes')

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)

    const controller = new AbortController()
    // The network logo is stored just before the per-asset loop starts — aborting as
    // a side effect of that call means every asset's own `signal.aborted` guard fires.
    harness.dbModule.fetchImageAndStoreForList.mockImplementationOnce(async (input: { listId: string }) => {
      controller.abort()
      return { list: harness.state.lists.find((list) => list.listId === input.listId) }
    })
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('stops processing once the signal is already aborted', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xAsset1'])
    fakeFilesystem.setFile(
      assetInfoJsonPath('smartchain', '0xAsset1'),
      JSON.stringify({ name: 'Asset One', symbol: 'AST1', decimals: 18 }),
    )
    fakeFilesystem.setFile(assetLogoPngPath('smartchain', '0xAsset1'), 'asset-logo-bytes')

    const { default: TrustWalletCollector } = await importTrustWallet()
    const collector = new TrustWalletCollector()
    await collector.discover(new AbortController().signal)
    const controller = new AbortController()
    controller.abort()
    await collector.collect(controller.signal)

    expect(harness.state.tokenImages).toHaveLength(0)
  })
})

describe('TrustWalletCollector standalone collect()', () => {
  it('runs discover() then collect() against a fresh collector instance', async () => {
    setInfoJson('smartchain')
    fakeFilesystem.setDirectory(blockchainsRoot, ['smartchain'])
    fakeFilesystem.setDirectory(assetsFolderPath('smartchain'), ['0xAsset1'])
    fakeFilesystem.setFile(
      assetInfoJsonPath('smartchain', '0xAsset1'),
      JSON.stringify({ name: 'Asset One', symbol: 'AST1', decimals: 18 }),
    )
    fakeFilesystem.setFile(assetLogoPngPath('smartchain', '0xAsset1'), 'asset-logo-bytes')

    const { collect } = await importTrustWallet()
    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['trustwallet'])
    expect(harness.state.tokenImages).toHaveLength(2)
  })
})
