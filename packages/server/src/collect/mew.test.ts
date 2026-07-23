import { describe, it, expect, vi, beforeEach } from 'vitest'
import { harness } from './__testing__/collector-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)

beforeEach(() => {
  harness.reset()
})

import mew, { collect } from './mew'

const SOURCE_URL =
  'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/dist/tokens/eth/tokens-eth.json'

const validRecord = (overrides: Record<string, unknown> = {}) => ({
  symbol: 'NANI',
  name: 'NANI',
  address: '0x00000000000007C8612bA63Df8DdEfD9E6077c97',
  decimals: 18,
  ...overrides,
})

describe('mew collector', () => {
  // Runs before any other test in this file calls discover(), so the module-level
  // collector instance still has its pristine, never-discovered private state —
  // exactly the case this guards against (a stray or out-of-order collect() call).
  it('does nothing when collect() runs before discover() has produced a token list', async () => {
    await mew.collect(new AbortController().signal)

    expect(harness.state.providers).toHaveLength(0)
    expect(harness.state.tokenImages).toHaveLength(0)
  })

  it('parses the raw ethereum-lists-shaped array, naming the provider up front', async () => {
    harness.queueTokenListResponse(SOURCE_URL, [validRecord(), { symbol: 'BAD' }] as never)

    const manifest = await mew.discover(new AbortController().signal)

    expect(harness.state.providers).toEqual([
      { providerId: 'provider:mew', key: 'mew', name: 'MyEtherWallet', description: null },
    ])
    expect(manifest).toEqual([{ providerKey: 'mew', lists: [{ listKey: 'tokens-eth', listId: expect.any(String) }] }])
  })

  it('collects the tokens discover() already parsed, without re-fetching', async () => {
    harness.queueTokenListResponse(SOURCE_URL, [validRecord()] as never)
    await mew.discover(new AbortController().signal)

    await mew.collect(new AbortController().signal)

    expect(harness.dbModule.cachedJSONRequest).toHaveBeenCalledTimes(1)
    expect(harness.state.tokenImages).toHaveLength(1)
    expect(harness.state.tokenImages[0]?.token.providedId).toBe('0x00000000000007c8612ba63df8ddefd9e6077c97')
  })

  it('logs a failure and discovers nothing when every record fails to parse', async () => {
    harness.queueTokenListResponse(SOURCE_URL, [{ symbol: 'BAD' }] as never)

    const manifest = await mew.discover(new AbortController().signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
    expect(harness.gibsUtilsModule.failureLog).toHaveBeenCalledWith(
      'provider=%o produced no tokens from %o',
      'mew',
      SOURCE_URL,
    )
  })

  it('treats a non-array response the same as an empty record set', async () => {
    harness.queueTokenListResponse(SOURCE_URL, { not: 'an array' } as never)

    const manifest = await mew.discover(new AbortController().signal)

    expect(manifest).toEqual([])
  })

  it('stops before registering anything once the signal is already aborted', async () => {
    harness.queueTokenListResponse(SOURCE_URL, [validRecord()] as never)
    const controller = new AbortController()
    controller.abort()

    const manifest = await mew.discover(controller.signal)

    expect(manifest).toEqual([])
    expect(harness.state.providers).toHaveLength(0)
  })

  it('discovers nothing when the underlying inmemory-tokenlist discover() aborts mid-run', async () => {
    harness.queueTokenListResponse(SOURCE_URL, [validRecord()] as never)
    const controller = new AbortController()
    // Aborts as a side effect of inmemory-tokenlist's own per-network insert, so the
    // signal is still clean when mew's own pre-check runs but flips before
    // inmemory-tokenlist.discover reaches its post-network abort check.
    const originalInsertNetworkFromChainId = harness.dbModule.insertNetworkFromChainId.getMockImplementation()!
    harness.dbModule.insertNetworkFromChainId.mockImplementationOnce(
      async (chainId: number | string, type?: string) => {
        controller.abort()
        return originalInsertNetworkFromChainId(chainId, type)
      },
    )

    const manifest = await mew.discover(controller.signal)

    expect(manifest).toEqual([])
  })

  it('exposes a standalone collect() that runs discover() then collect() in sequence', async () => {
    harness.queueTokenListResponse(SOURCE_URL, [validRecord()] as never)

    await collect(new AbortController().signal)

    expect(harness.state.providers.map((provider) => provider.key)).toEqual(['mew'])
    expect(harness.state.tokenImages).toHaveLength(1)
  })
})
