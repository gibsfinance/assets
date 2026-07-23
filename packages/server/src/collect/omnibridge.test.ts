import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Chain, Hex } from 'viem'
import { omnibridgeHarness as harness } from './__testing__/omnibridge-harness'

vi.mock('../db', () => harness.dbModule)
vi.mock('../utils', () => harness.utilsModule)
vi.mock('@gibs/utils', () => harness.gibsUtilsModule)
vi.mock('../utils/delay', () => ({ delay: harness.delayMock }))
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  // `harness.getContract` cannot be referenced directly here: loading
  // omnibridge-harness.ts (which this file imports below) itself imports
  // `viem`, so this factory runs *during* that import — before the
  // `harness` binding above is initialized. Wrapping in a function that
  // only touches `harness` when actually invoked (well after every module
  // has finished loading) sidesteps the temporal-dead-zone error.
  return {
    ...actual,
    getContract: (...args: Parameters<typeof actual.getContract>) => harness.getContract(...args),
  }
})

beforeEach(() => {
  harness.reset()
})

import OmnibridgeCollector, { collectByBridgeConfig, collect } from './omnibridge'

const HOME_CHAIN = { id: 1, name: 'home-fixture-chain' } as unknown as Chain
const FOREIGN_CHAIN = { id: 100, name: 'foreign-fixture-chain' } as unknown as Chain

const HOME_ADDRESS = `0x${'a'.repeat(40)}` as Hex
const FOREIGN_ADDRESS = `0x${'b'.repeat(40)}` as Hex

const NATIVE_TOKEN_ADDRESS = `0x${'1'.repeat(40)}` as Hex
const BRIDGED_TOKEN_ADDRESS = `0x${'2'.repeat(40)}` as Hex
const SECOND_NATIVE_TOKEN_ADDRESS = `0x${'3'.repeat(40)}` as Hex
const SECOND_BRIDGED_TOKEN_ADDRESS = `0x${'4'.repeat(40)}` as Hex
const TRANSACTION_HASH = `0x${'5'.repeat(64)}` as Hex
const SECOND_TRANSACTION_HASH = `0x${'6'.repeat(64)}` as Hex

const buildConfig = (overrides: Partial<Parameters<typeof collectByBridgeConfig>[0]> = {}) => ({
  providerPrefix: 'fixture',
  home: { address: HOME_ADDRESS, chain: HOME_CHAIN, startBlock: 100 },
  foreign: { address: FOREIGN_ADDRESS, chain: FOREIGN_CHAIN, startBlock: 200 },
  ...overrides,
})

const newTokenRegisteredEvent = (native: Hex, bridged: Hex, transactionHash: Hex) => ({
  args: { native, bridged },
  transactionHash,
})

/**
 * Every test drives the "home -> foreign" direction (which scans the foreign
 * contract, keyed by `FOREIGN_ADDRESS`) for its interesting behavior, while
 * keeping the "foreign -> home" direction (scanning `HOME_ADDRESS`) trivial —
 * a single already-finalized range that resolves to no events — since
 * `collectByBridgeConfig` always runs both directions concurrently and this
 * keeps assertions about one direction's call history unambiguous.
 */
const quietTheReverseDirection = () => {
  harness.setFinalizedBlock(HOME_CHAIN.id, 150n)
}

describe('omnibridge collector: discover()', () => {
  it('registers a provider, both networks, both lists, and a bridge row per config entry', async () => {
    const config = buildConfig()
    const collector = new OmnibridgeCollector([config])

    const manifest = await collector.discover(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['fixture-bridge'])
    expect(manifest).toHaveLength(1)
    expect(manifest[0].providerKey).toBe('fixture-bridge')
    expect(manifest[0].lists.map((l) => l.listKey)).toEqual(['home', 'foreign', 'on-home', 'on-foreign'])
    expect(manifest[0].lists.every((l) => typeof l.listId === 'string')).toBe(true)

    const bridge = harness.findBridge({
      type: 'omnibridge',
      providerId: harness.state.providers[0].providerId,
      homeNetworkId: harness.utilsModule.chainIdToNetworkId(HOME_CHAIN.id),
      homeAddress: HOME_ADDRESS,
      foreignNetworkId: harness.utilsModule.chainIdToNetworkId(FOREIGN_CHAIN.id),
      foreignAddress: FOREIGN_ADDRESS,
    })
    expect(bridge).toBeDefined()
  })

  it('prefixes the provider key with "testnet-<prefix>-" when testnetPrefix is set', async () => {
    const config = buildConfig({ testnetPrefix: 'sepolia' })
    const collector = new OmnibridgeCollector([config])

    const manifest = await collector.discover(new AbortController().signal)

    expect(manifest[0].providerKey).toBe('testnet-sepolia-fixture-bridge')
    expect(harness.state.providers.map((p) => p.key)).toEqual(['testnet-sepolia-fixture-bridge'])
  })

  it('records a custom bridge type instead of defaulting to "omnibridge"', async () => {
    const config = buildConfig({ type: 'custom-bridge-type' })
    const collector = new OmnibridgeCollector([config])
    await collector.discover(new AbortController().signal)

    const bridge = harness.findBridge({
      type: 'custom-bridge-type',
      providerId: harness.state.providers[0].providerId,
      homeNetworkId: harness.utilsModule.chainIdToNetworkId(HOME_CHAIN.id),
      homeAddress: HOME_ADDRESS,
      foreignNetworkId: harness.utilsModule.chainIdToNetworkId(FOREIGN_CHAIN.id),
      foreignAddress: FOREIGN_ADDRESS,
    })
    expect(bridge?.type).toBe('custom-bridge-type')
  })
})

describe('omnibridge collector: paging through block ranges', () => {
  it('walks multiple 10,000-block pages in order and persists the cursor as it advances', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents.mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    expect(foreignEvents.mock.calls.map(([, range]) => range)).toEqual([
      { fromBlock: 200n, toBlock: 10199n },
      { fromBlock: 10199n, toBlock: 20198n },
      { fromBlock: 20198n, toBlock: 25000n },
    ])

    const bridge = harness.findBridge({
      type: 'omnibridge',
      providerId: harness.state.providers[0].providerId,
      homeNetworkId: harness.utilsModule.chainIdToNetworkId(HOME_CHAIN.id),
      homeAddress: HOME_ADDRESS,
      foreignNetworkId: harness.utilsModule.chainIdToNetworkId(FOREIGN_CHAIN.id),
      foreignAddress: FOREIGN_ADDRESS,
    })
    expect(bridge?.currentForeignBlockNumber).toBe('25000')
  })

  it('advances and persists the block cursor for a range with no matching events, without writing any tokens', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    harness.getEventsMockFor(FOREIGN_ADDRESS).mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    expect(harness.state.tokens.size).toBe(0)
    expect(harness.state.bridgeLinks).toHaveLength(0)
    const bridge = harness.findBridge({
      type: 'omnibridge',
      providerId: harness.state.providers[0].providerId,
      homeNetworkId: harness.utilsModule.chainIdToNetworkId(HOME_CHAIN.id),
      homeAddress: HOME_ADDRESS,
      foreignNetworkId: harness.utilsModule.chainIdToNetworkId(FOREIGN_CHAIN.id),
      foreignAddress: FOREIGN_ADDRESS,
    })
    expect(bridge?.currentForeignBlockNumber).toBe('5000')
  })

  it('resumes from the persisted cursor on a later run instead of rescanning from startBlock', async () => {
    quietTheReverseDirection()
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents.mockResolvedValue([])

    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    await collectByBridgeConfig(config, new AbortController().signal)

    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 8_000n)
    await collectByBridgeConfig(config, new AbortController().signal)

    expect(foreignEvents.mock.calls.map(([, range]) => range)).toEqual([
      { fromBlock: 200n, toBlock: 5000n },
      { fromBlock: 5000n, toBlock: 8000n },
    ])
  })
})

describe('omnibridge collector: pairing native and bridged tokens', () => {
  it('inserts both sides of a NewTokenRegistered event and links them with an incrementing bridgeLinkOrderId', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    harness
      .getEventsMockFor(FOREIGN_ADDRESS)
      .mockResolvedValue([newTokenRegisteredEvent(NATIVE_TOKEN_ADDRESS, BRIDGED_TOKEN_ADDRESS, TRANSACTION_HASH)])
    harness.setErc20Metadata(NATIVE_TOKEN_ADDRESS, ['Native Fixture', 'NAT', 18])
    harness.setErc20Metadata(BRIDGED_TOKEN_ADDRESS, ['Bridged Fixture', 'BRG', 6])

    await collectByBridgeConfig(config, new AbortController().signal)

    const homeNetworkId = harness.utilsModule.chainIdToNetworkId(HOME_CHAIN.id)
    const foreignNetworkId = harness.utilsModule.chainIdToNetworkId(FOREIGN_CHAIN.id)
    const nativeToken = harness.state.tokens.get(`${homeNetworkId}:${NATIVE_TOKEN_ADDRESS.toLowerCase()}`)
    const bridgedToken = harness.state.tokens.get(`${foreignNetworkId}:${BRIDGED_TOKEN_ADDRESS.toLowerCase()}`)
    expect(nativeToken).toMatchObject({ name: 'Native Fixture', symbol: 'NAT', decimals: 18 })
    expect(bridgedToken).toMatchObject({ name: 'Bridged Fixture', symbol: 'BRG', decimals: 6 })

    expect(harness.state.bridgeLinks).toHaveLength(1)
    expect(harness.state.bridgeLinks[0]).toMatchObject({
      nativeTokenId: nativeToken?.tokenId,
      bridgedTokenId: bridgedToken?.tokenId,
      transactionHash: TRANSACTION_HASH,
    })

    const bridge = harness.findBridge({
      type: 'omnibridge',
      providerId: harness.state.providers[0].providerId,
      homeNetworkId,
      homeAddress: HOME_ADDRESS,
      foreignNetworkId,
      foreignAddress: FOREIGN_ADDRESS,
    })
    // Two `storeToken` calls happen per event (native side, then bridged side),
    // both drawing from the same running `count` counter, so the persisted
    // order id advances by 2 for a single paired event — see the write-up in
    // the final report for why both sides are also filed under the same list.
    expect(bridge?.bridgeLinkOrderId).toBe(2)
  })

  it('pairs two events in the same range with sequential order ids and two bridge links', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    harness
      .getEventsMockFor(FOREIGN_ADDRESS)
      .mockResolvedValue([
        newTokenRegisteredEvent(NATIVE_TOKEN_ADDRESS, BRIDGED_TOKEN_ADDRESS, TRANSACTION_HASH),
        newTokenRegisteredEvent(SECOND_NATIVE_TOKEN_ADDRESS, SECOND_BRIDGED_TOKEN_ADDRESS, SECOND_TRANSACTION_HASH),
      ])
    harness.setErc20Metadata(NATIVE_TOKEN_ADDRESS, ['Native One', 'N1', 18])
    harness.setErc20Metadata(BRIDGED_TOKEN_ADDRESS, ['Bridged One', 'B1', 18])
    harness.setErc20Metadata(SECOND_NATIVE_TOKEN_ADDRESS, ['Native Two', 'N2', 18])
    harness.setErc20Metadata(SECOND_BRIDGED_TOKEN_ADDRESS, ['Bridged Two', 'B2', 18])

    await collectByBridgeConfig(config, new AbortController().signal)

    expect(harness.state.bridgeLinks).toHaveLength(2)
    expect(harness.state.tokens.size).toBe(4)
  })

  /** Every list key the given token address ended up a member of. */
  const listKeysHolding = (address: Hex) => {
    const token = [...harness.state.tokens.values()].find((t) => t.providedId === address.toLowerCase())
    const keyByListId = new Map(harness.state.lists.map((l) => [l.listId, l.key]))
    return new Set(
      [...harness.state.listTokens.values()]
        .filter((lt) => lt.tokenId === token?.tokenId)
        .map((lt) => keyByListId.get(lt.listId)),
    )
  }

  /**
   * The direction lists keep exactly the contents they had before the
   * chain-scoped lists existed — that is the compatibility guarantee for
   * anything already reading `home` or `foreign`. What is new is a second
   * membership per token, in the list for the chain that token is on.
   */
  it('adds a chain-scoped membership without disturbing the direction list', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    harness
      .getEventsMockFor(FOREIGN_ADDRESS)
      .mockResolvedValue([newTokenRegisteredEvent(NATIVE_TOKEN_ADDRESS, BRIDGED_TOKEN_ADDRESS, TRANSACTION_HASH)])
    harness.setErc20Metadata(NATIVE_TOKEN_ADDRESS, ['Native Fixture', 'NAT', 18])
    harness.setErc20Metadata(BRIDGED_TOKEN_ADDRESS, ['Bridged Fixture', 'BRG', 6])

    await collectByBridgeConfig(config, new AbortController().signal)

    // Both sides are still in `foreign`, the list for the direction that observed
    // them. The native token additionally joins `on-home` because that is where
    // it lives, even though the home->foreign pass is what found it.
    expect(listKeysHolding(NATIVE_TOKEN_ADDRESS)).toEqual(new Set(['foreign', 'on-home']))
    expect(listKeysHolding(BRIDGED_TOKEN_ADDRESS)).toEqual(new Set(['foreign', 'on-foreign']))
  })

  it('keeps every chain-scoped list to a single network, whichever direction found the token', async () => {
    // Both directions collect here, so each chain-scoped list is fed from both:
    // one direction contributes its native side, the other its wrapper. A list
    // that stayed single-network only because one direction ran would prove
    // nothing.
    harness.setFinalizedBlock(HOME_CHAIN.id, 5_000n)
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    harness
      .getEventsMockFor(FOREIGN_ADDRESS)
      .mockResolvedValue([newTokenRegisteredEvent(NATIVE_TOKEN_ADDRESS, BRIDGED_TOKEN_ADDRESS, TRANSACTION_HASH)])
    harness
      .getEventsMockFor(HOME_ADDRESS)
      .mockResolvedValue([
        newTokenRegisteredEvent(SECOND_NATIVE_TOKEN_ADDRESS, SECOND_BRIDGED_TOKEN_ADDRESS, SECOND_TRANSACTION_HASH),
      ])
    for (const address of [
      NATIVE_TOKEN_ADDRESS,
      BRIDGED_TOKEN_ADDRESS,
      SECOND_NATIVE_TOKEN_ADDRESS,
      SECOND_BRIDGED_TOKEN_ADDRESS,
    ]) {
      harness.setErc20Metadata(address, ['Fixture', 'FIX', 18])
    }

    await collectByBridgeConfig(config, new AbortController().signal)

    // A list whose networkId names a chain its members are not on is the defect
    // these lists exist to avoid: `/list` publishes that networkId as the list's
    // chainId and filters on it, so it has to hold for every member.
    const tokensById = new Map([...harness.state.tokens.values()].map((t) => [t.tokenId, t]))
    for (const key of ['on-home', 'on-foreign']) {
      const list = harness.state.lists.find((l) => l.key === key)!
      const memberNetworkIds = new Set(
        [...harness.state.listTokens.values()]
          .filter((lt) => lt.listId === list.listId)
          .map((lt) => tokensById.get(lt.tokenId)!.networkId),
      )
      expect([...memberNetworkIds]).toEqual([list.networkId])
    }
  })
})

describe('omnibridge collector: range failure handling', () => {
  it('replays the same range after a non-"limit" error instead of skipping past it', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents.mockRejectedValueOnce(new Error('connection reset by peer')).mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    const ranges = foreignEvents.mock.calls.map(([, range]) => range)
    // Advancing past the window that threw would retire blocks nobody read.
    // The cursor is persisted from the ranges that succeed, so the next run
    // resumes after the gap and every NewTokenRegistered event inside it is
    // lost for good — the failure has to cost a replay, not a hole.
    expect(ranges[0]).toEqual({ fromBlock: 200n, toBlock: 10199n })
    expect(ranges[1]).toEqual({ fromBlock: 200n, toBlock: 10199n })
    // The step is untouched: a dropped connection says nothing about how many
    // blocks the endpoint is willing to serve, so shrinking it would be guessing.
    expect(ranges[2]).toEqual({ fromBlock: 10199n, toBlock: 20198n })
  })

  it('backs off further on each consecutive non-"limit" failure', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents
      .mockRejectedValueOnce(new Error('connection reset by peer'))
      .mockRejectedValueOnce(new Error('connection reset by peer'))
      .mockRejectedValueOnce(new Error('connection reset by peer'))
      .mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    // Retrying a struggling endpoint at a fixed interval is how a rate-limited
    // or restarting node gets held down; each successive wait has to give it
    // more room than the last.
    const waits = harness.delayMock.mock.calls.map(([ms]) => ms)
    expect(waits.slice(0, 3)).toEqual([5_000, 10_000, 20_000])
  })

  it('halves the step and retries the same starting block on a "limit"-flavored error', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents.mockRejectedValueOnce(new Error('response size exceeds limit')).mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    const ranges = foreignEvents.mock.calls.map(([, range]) => range)
    expect(ranges[0]).toEqual({ fromBlock: 200n, toBlock: 10199n })
    // Same fromBlock retried with a halved step (10,000 -> 5,000).
    expect(ranges[1]).toEqual({ fromBlock: 200n, toBlock: 5199n })
  })

  it('gives up on a range that keeps failing, falling back to the raw error when it has no message', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents
      .mockRejectedValueOnce(new Error('rpc unavailable'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      .mockRejectedValueOnce(new Error('still unavailable'))
      // A rejection with no `.message` (a bare string, as some RPC transports throw)
      // exercises the `err.message || err` fallback in the final thrown error.
      .mockRejectedValueOnce('boom')

    // Since a failed range is now replayed rather than skipped, this bound is the
    // only thing that ends the loop for an endpoint that never recovers. It has
    // to surface as an error the operator sees: stopping here leaves the cursor
    // on the last range that succeeded, so the next run resumes correctly.
    await expect(collectByBridgeConfig(config, new AbortController().signal)).rejects.toThrow(
      /Failed after 5 consecutive attempts.*boom/,
    )
    expect(foreignEvents).toHaveBeenCalledTimes(5)
  })

  it('recognizes a rate-limit error carried in a `.details` field even when the message does not mention it', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    // No `.message` at all, and "exceeds" (not "limit") only shows up in `.details` —
    // covers both the `err.message || ''` fallback and the `errorText.includes('exceeds')`
    // half of the limit-detection check independently of the `.includes('limit')` half.
    foreignEvents.mockRejectedValueOnce({ details: 'block range exceeds maximum allowed' }).mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    const ranges = foreignEvents.mock.calls.map(([, range]) => range)
    expect(ranges[0]).toEqual({ fromBlock: 200n, toBlock: 10199n })
    // Treated as a limit error: same fromBlock retried with a halved step.
    expect(ranges[1]).toEqual({ fromBlock: 200n, toBlock: 5199n })
  })

  it('gives up once non-consecutive "limit" errors shrink the step below the minimum viable range', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 10_000_000n)
    const config = buildConfig()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)

    // The consecutive-failures throw (tested above) only fires when the same
    // range fails five times *in a row*. Here every "limit" rejection is
    // immediately followed by a success, so `consecutiveErrors` resets to 0
    // before it ever reaches the bound — that throw never fires. But `currentStep` is
    // never reset by a success, only grown 20%, while each error still halves
    // it (net *0.6 per error/success cycle), so it keeps sliding down across
    // enough cycles regardless of how the errors are spaced out. 12 halvings
    // (interleaved with 11 successes) walks 10,000 down past the 25-block
    // floor: 10000 -> 6000 -> 3600 -> ... -> 34 -> throws at 17.
    const limitError = () => Promise.reject(new Error('response size exceeds limit'))
    const success = () => Promise.resolve([])
    for (let cycle = 0; cycle < 11; cycle++) {
      foreignEvents.mockImplementationOnce(limitError)
      foreignEvents.mockImplementationOnce(success)
    }
    foreignEvents.mockImplementationOnce(limitError)

    await expect(collectByBridgeConfig(config, new AbortController().signal)).rejects.toThrow(
      /Block range too small \(17 blocks\) - minimum viable range is 25 blocks/,
    )
    // 11 full error/success cycles plus the final, unpaired 12th error.
    expect(foreignEvents).toHaveBeenCalledTimes(23)
  })

  it('runs collectByBridgeConfig under a config with a testnet prefix', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 10_199n)
    const config = buildConfig({ testnetPrefix: 'sepolia' })
    harness.getEventsMockFor(FOREIGN_ADDRESS).mockResolvedValue([])

    await collectByBridgeConfig(config, new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['testnet-sepolia-fixture-bridge'])
  })
})

describe('omnibridge collector: cancellation', () => {
  it('does not write a provider, list, or bridge row when the signal is already aborted', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    const controller = new AbortController()
    controller.abort()

    await collectByBridgeConfig(config, controller.signal)

    expect(harness.state.providers).toHaveLength(0)
    expect(harness.getEventsMockFor(FOREIGN_ADDRESS)).not.toHaveBeenCalled()
  })

  it('discards a non-empty range fetched right before an abort was observed, without reading token metadata', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    const controller = new AbortController()
    harness.getEventsMockFor(FOREIGN_ADDRESS).mockImplementationOnce(async () => {
      controller.abort()
      return [newTokenRegisteredEvent(NATIVE_TOKEN_ADDRESS, BRIDGED_TOKEN_ADDRESS, TRANSACTION_HASH)]
    })

    await collectByBridgeConfig(config, controller.signal)

    expect(harness.gibsUtilsModule.erc20Read).not.toHaveBeenCalled()
    expect(harness.state.bridgeLinks).toHaveLength(0)
  })

  it('discards an event pair whose token reads resolved after the signal was aborted mid-fetch', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    const controller = new AbortController()
    harness
      .getEventsMockFor(FOREIGN_ADDRESS)
      .mockResolvedValue([newTokenRegisteredEvent(NATIVE_TOKEN_ADDRESS, BRIDGED_TOKEN_ADDRESS, TRANSACTION_HASH)])
    harness.setErc20Metadata(NATIVE_TOKEN_ADDRESS, ['Native Fixture', 'NAT', 18])
    harness.setErc20Metadata(BRIDGED_TOKEN_ADDRESS, () => {
      controller.abort()
      return ['Bridged Fixture', 'BRG', 6] as const
    })

    await collectByBridgeConfig(config, controller.signal)

    expect(harness.gibsUtilsModule.erc20Read).toHaveBeenCalledTimes(2)
    expect(harness.state.bridgeLinks).toHaveLength(0)
    expect(harness.state.tokens.size).toBe(0)
  })

  it('stops paging once the signal is aborted between ranges, without rolling back the range already committed', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const controller = new AbortController()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents.mockImplementationOnce(async () => {
      controller.abort()
      return []
    })

    await collectByBridgeConfig(config, controller.signal)

    expect(foreignEvents).toHaveBeenCalledTimes(1)
    const bridge = harness.findBridge({
      type: 'omnibridge',
      providerId: harness.state.providers[0].providerId,
      homeNetworkId: harness.utilsModule.chainIdToNetworkId(HOME_CHAIN.id),
      homeAddress: HOME_ADDRESS,
      foreignNetworkId: harness.utilsModule.chainIdToNetworkId(FOREIGN_CHAIN.id),
      foreignAddress: FOREIGN_ADDRESS,
    })
    expect(bridge?.currentForeignBlockNumber).toBe('10199')
  })

  it('swallows an in-flight error instead of retrying when the signal aborts during the retry backoff', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const controller = new AbortController()
    const foreignEvents = harness.getEventsMockFor(FOREIGN_ADDRESS)
    foreignEvents.mockRejectedValueOnce(new Error('temporary rpc hiccup'))
    // The real `delay()` rejects with the abort reason when the signal fires
    // mid-wait; `iterateOverRange` swallows that via `.catch(() => {})` before
    // checking `signal.aborted` itself, so the retry backoff's rejection path
    // needs modeling too, not just the resolved-instantly default.
    harness.delayMock.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('aborted mid-delay')
    })

    await expect(collectByBridgeConfig(config, controller.signal)).resolves.toBeUndefined()

    expect(foreignEvents).toHaveBeenCalledTimes(1)
  })
})

describe('omnibridge collector: collect() and the standalone factory', () => {
  it('collect() runs every configured bridge and completes cleanly', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    const collector = new OmnibridgeCollector([config])
    harness.getEventsMockFor(FOREIGN_ADDRESS).mockResolvedValue([])

    await collector.discover(new AbortController().signal)
    await expect(collector.collect(new AbortController().signal)).resolves.toBeUndefined()
  })

  it('collect() propagates a rejection from any configured bridge', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 25_000n)
    const config = buildConfig()
    const collector = new OmnibridgeCollector([config])
    harness.getEventsMockFor(FOREIGN_ADDRESS).mockRejectedValue(new Error('rpc unavailable'))

    await collector.discover(new AbortController().signal)
    await expect(collector.collect(new AbortController().signal)).rejects.toThrow(/Failed after 5 consecutive/)
  })

  it('the standalone collect(config) factory discovers then collects', async () => {
    quietTheReverseDirection()
    harness.setFinalizedBlock(FOREIGN_CHAIN.id, 5_000n)
    const config = buildConfig()
    harness.getEventsMockFor(FOREIGN_ADDRESS).mockResolvedValue([])

    const run = collect([config])
    await run(new AbortController().signal)

    expect(harness.state.providers.map((p) => p.key)).toEqual(['fixture-bridge'])
  })
})
