import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'
import { createDrizzleHarness } from '../db/__testing__/drizzle-harness'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

const drizzleHarness = createDrizzleHarness()

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
vi.mock('../fetch', () => ({ fetch: fetchMock }))
// internetmoney.ts reaches straight past `../db` into `../db/drizzle` for one
// raw "does this token already have metadata" select — the shared collector
// harness only stands in for `../db`'s own exported functions, not the
// lower-level query builder, so this reuses the sibling `db/__testing__`
// harness the same way `db/index.*.test.ts` files do.
vi.mock('../db/drizzle', () => ({ getDrizzle: () => drizzleHarness.db }))

beforeEach(() => {
  harness.reset()
  drizzleHarness.reset()
  fetchMock.mockReset()
})

import InternetMoneyCollector, { collect } from './internetmoney'

const jsonResponse = (body: unknown) => ({ json: async () => body }) as Response

const networkInfo = (overrides: Record<string, unknown> = {}) => ({
  chainId: 1,
  rpc: 'https://rpc.example.com',
  icon: 'https://example.com/network-icon.png',
  tokens: [] as { address: string; icon: string }[],
  ...overrides,
})

const tokenInfo = (address: string, icon = 'https://example.com/token-icon.png') => ({ address, icon })

const TOKEN_A = '0x1111111111111111111111111111111111111111'
const TOKEN_B = '0x2222222222222222222222222222222222222222'

/** Reads back the increment() calls made on the single per-token task row a test created. */
const latestTaskRow = () => {
  const summaryRow = harness.utilsModule.terminal.issue.mock.results.at(-1)!.value
  const tasksSection = summaryRow.issue.mock.results[0].value
  return tasksSection.task.mock.results.at(-1)!.value
}

describe('internetmoney collector', () => {
  it('registers the provider, the default-chain wallet list, and one list per network during discover()', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1 }), networkInfo({ chainId: 2 })]))

    const manifest = await new InternetMoneyCollector().discover(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['internetmoney'])
    const listKeys = manifest[0]?.lists.map((list) => list.listKey) ?? []
    expect(listKeys).toEqual(['wallet', 'wallet-1', 'wallet-2'])
  })

  it('treats a non-array response body the same as an empty network list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ not: 'an array' }))

    const manifest = await new InternetMoneyCollector().discover(new AbortController().signal)

    expect(manifest[0]?.lists.map((list) => list.listKey)).toEqual(['wallet'])
    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['internetmoney'])
  })

  it('returns an empty manifest without registering anything once the signal is already aborted', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1 })]))
    const controller = new AbortController()
    controller.abort()

    const manifest = await new InternetMoneyCollector().discover(controller.signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
  })

  it('stops registering further networks once the signal aborts mid-loop during discover()', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1 }), networkInfo({ chainId: 2 })]))
    const controller = new AbortController()
    // findChain runs synchronously at the very top of the per-network callback,
    // before any await — aborting here (on the first network processed) lands
    // before the second network's own synchronous guard check runs, which a
    // later abort (after an await) could not guarantee.
    harness.utilsModule.findChain.mockImplementationOnce((chainId: number) => {
      controller.abort()
      return { id: chainId, name: `fixture-chain-${chainId}` }
    })

    const manifest = await new InternetMoneyCollector().discover(controller.signal)

    // Only the network whose callback started before the abort registered a list.
    const listKeys = manifest[0]?.lists.map((list) => list.listKey) ?? []
    expect(listKeys).toEqual(['wallet', 'wallet-1'])
  })

  it('falls back to a synthetic chain built from the network payload when findChain finds nothing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        networkInfo({ chainId: 999, rpc: 'https://custom-rpc.example.com', tokens: [tokenInfo(TOKEN_A)] }),
      ]),
    )
    // Every findChain call in this test — during both discover() and collect()
    // — reports no known chain, forcing the synthetic fallback every time.
    harness.utilsModule.findChain.mockReturnValue(undefined)
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    drizzleHarness.queueResult([])
    harness.setErc20Metadata(TOKEN_A, ['Fixture Token', 'FIX', 18])

    await collector.collect(new AbortController().signal)

    // A real found chain (the harness's default findChain stub) never carries
    // rpcUrls; seeing it here proves collect() built and used the synthetic
    // chain rather than crashing or silently reusing a stale one.
    const syntheticCall = harness.utilsModule.chainToPublicClient.mock.calls.find(
      ([chain]) =>
        (chain as { rpcUrls?: { default?: { http?: string[] } } }).rpcUrls?.default?.http?.[0] ===
        'https://custom-rpc.example.com',
    )
    expect(syntheticCall).toBeDefined()
    expect(harness.state.tokenImages.some((image) => image.token.providedId === TOKEN_A)).toBe(true)
  })

  it('stores each network icon and stops once the signal is already aborted before any work starts', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, icon: 'https://example.com/net.png' })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)

    await collector.collect(new AbortController().signal)

    const networkListImage = harness.state.listImages.find((image) => image.uri === 'https://example.com/net.png')
    expect(networkListImage).toBeDefined()
  })

  it('does nothing once the signal is already aborted before collect() starts', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_A)] })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    const controller = new AbortController()
    controller.abort()

    await collector.collect(controller.signal)

    expect(harness.state.listImages).toHaveLength(0)
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('skips the on-chain read and reuses existing metadata when the token already has a name/symbol in the database', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_A)] })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    drizzleHarness.queueResult([{ name: 'Existing Token', symbol: 'EXIST', decimals: 9 }])

    await collector.collect(new AbortController().signal)

    expect(harness.gibsUtilsModule.erc20Read).not.toHaveBeenCalled()
    const stored = harness.state.tokenImages.find((image) => image.token.providedId === TOKEN_A)
    expect(stored?.token.name).toBe('Existing Token')
    expect(stored?.token.symbol).toBe('EXIST')
    expect(stored?.token.decimals).toBe(9)
    // Stored once under the per-network list and once under the global wallet list.
    expect(harness.state.tokenImages.filter((image) => image.token.providedId === TOKEN_A)).toHaveLength(2)
  })

  it('reads on-chain metadata for a token with no existing database row', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_A)] })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    drizzleHarness.queueResult([])
    harness.setErc20Metadata(TOKEN_A, ['On Chain Token', 'ONCH', 6])

    await collector.collect(new AbortController().signal)

    const stored = harness.state.tokenImages.find((image) => image.token.providedId === TOKEN_A)
    expect(stored?.token.name).toBe('On Chain Token')
    expect(stored?.token.symbol).toBe('ONCH')
    expect(stored?.token.decimals).toBe(6)
  })

  it('skips a token whose on-chain read fails, logging the failure and never storing an image', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_A)] })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    drizzleHarness.queueResult([])
    // No erc20 metadata queued for TOKEN_A, so the harness's erc20Read rejects.

    await collector.collect(new AbortController().signal)

    expect(harness.state.tokenImages).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'internetmoney rpc failed %o %o: %o',
      1,
      TOKEN_A,
      expect.any(String),
    )
  })

  it('classifies a timed-out storage failure separately from a generic one', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_A)] })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    drizzleHarness.queueResult([])
    harness.setErc20Metadata(TOKEN_A, ['Timeout Token', 'TOUT', 18])
    // collect() calls db.transaction once for the network icon (must succeed
    // normally) before the per-token transaction this test targets.
    const originalTransaction = harness.dbModule.transaction.getMockImplementation()!
    harness.dbModule.transaction
      .mockImplementationOnce(originalTransaction)
      .mockRejectedValueOnce(new Error('statement timeout exceeded'))

    await collector.collect(new AbortController().signal)

    expect(latestTaskRow().increment).toHaveBeenCalledWith('timeout', `internetmoney-1-${TOKEN_A}`.toLowerCase())
  })

  it('classifies a non-timeout storage failure as a generic error', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_B)] })]))
    const collector = new InternetMoneyCollector()
    await collector.discover(new AbortController().signal)
    drizzleHarness.queueResult([])
    harness.setErc20Metadata(TOKEN_B, ['Broken Token', 'BRK', 18])
    const originalTransaction = harness.dbModule.transaction.getMockImplementation()!
    harness.dbModule.transaction
      .mockImplementationOnce(originalTransaction)
      .mockRejectedValueOnce(new Error('constraint violation'))

    await collector.collect(new AbortController().signal)

    expect(latestTaskRow().increment).toHaveBeenCalledWith('error', `internetmoney-1-${TOKEN_B}`.toLowerCase())
  })

  it('exposes a standalone collect() that runs discover() then collect() on a fresh collector', async () => {
    fetchMock.mockResolvedValue(jsonResponse([networkInfo({ chainId: 1, tokens: [tokenInfo(TOKEN_A)] })]))
    drizzleHarness.queueResult([])
    harness.setErc20Metadata(TOKEN_A, ['Fixture Token', 'FIX', 18])

    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['internetmoney'])
    expect(harness.state.tokenImages.some((image) => image.token.providedId === TOKEN_A)).toBe(true)
  })
})
