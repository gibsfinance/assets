/**
 * Test harness for `omnibridge.ts` — a collector whose two input seams are
 * genuinely outside what `collector-harness.ts` models: it reads on-chain
 * event logs through a `viem` contract instance instead of fetching a token
 * list, and it writes through `../db`'s bridge-specific functions
 * (`insertBridge`, `getBridge`, `insertBridgeLink`, `updateBridgeBlockProgress`)
 * plus the image-less `storeToken` path, none of which `collector-harness.ts`
 * exposes.
 *
 * What is reused rather than reinvented:
 * - `insertProvider` / `insertList` / `insertNetworkFromChainId` / `transaction`
 *   / `chainIdToNetworkId` / `counterId` / `terminal` come straight from a
 *   fresh `createCollectorHarness()` instance — omnibridge.ts's discover()
 *   phase writes through exactly the same funnel `remote-tokenlist.ts` does.
 * - `storeToken` (and the `insertToken` / `insertListToken` it composes)
 *   comes from `createTokenStoreHarness()`, shared with `etherscan.ts`'s
 *   harness for the same reason.
 *
 * What is bespoke here:
 * - `insertBridge` / `getBridge` / `updateBridgeBlockProgress` /
 *   `insertBridgeLink` model the real `../db` identity semantics: a bridge
 *   row is keyed by `(type, providerId, home network+address, foreign
 *   network+address)` exactly like the real `gcid_bridge_*` trigger, so a
 *   second `insertBridge` call for the same bridge returns the *same* row —
 *   including whatever block-progress/`bridgeLinkOrderId` state a prior
 *   `updateBridgeBlockProgress` call already wrote. That persistence is the
 *   load-bearing behavior the paging tests exercise.
 * - `chainToPublicClient` returns a fake client exposing only `getChainId`
 *   and `getBlock`, since that is all `collectByBridgeConfig` calls on it —
 *   the actual log-scanning goes through `viem.getContract(...).getEvents`,
 *   which the test file mocks directly (see `viemGetContract` below) rather
 *   than reimplementing viem's real `getContractEvents` action against a fake
 *   JSON-RPC transport.
 * - `erc20Read` (`@gibs/utils`) is queued per-address, same shape as
 *   `collector-harness.ts`'s own `erc20Read` mock, but additionally accepts a
 *   function entry so a test can attach a side effect (e.g. aborting the
 *   signal mid-flight) to a specific on-chain read.
 * - `delay` (`../utils/delay`) resolves instantly by default so paging/retry
 *   tests never actually wait on wall-clock timers; a test can still attach a
 *   one-off side effect via `mockImplementationOnce` on the exported mock.
 */
import { vi, type Mock } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { canonicalBridgeAddress } from '../../db/provided-id'
import type { InsertableBridge, InsertableBridgeLink, Bridge } from '../../db/schema-types'
import type { DrizzleTx } from '../../db/drizzle'
import { createCollectorHarness } from './collector-harness'
import { createTokenStoreHarness } from './token-store-harness'

/** A row as the real `bridge` table would return it, trimmed to the columns the collector reads. */
export type RecordedBridgeRow = {
  bridgeId: string
  type: string
  providerId: string
  homeNetworkId: string
  homeAddress: string
  foreignNetworkId: string
  foreignAddress: string
  currentHomeBlockNumber: number | string
  currentForeignBlockNumber: number | string
  bridgeLinkOrderId: number
}

/** One call recorded from `insertBridgeLink`. */
export type RecordedBridgeLink = {
  bridgeLinkId: string
  bridgeId: string
  nativeTokenId: string
  bridgedTokenId: string
  transactionHash: string
}

type Erc20Entry =
  | readonly [name: string, symbol: string, decimals: number]
  | Error
  | (() => readonly [string, string, number] | Promise<readonly [string, string, number]>)

const bridgeIdentity = (bridge: InsertableBridge): string =>
  [
    bridge.type,
    bridge.providerId,
    bridge.homeNetworkId,
    canonicalBridgeAddress(bridge.homeAddress),
    bridge.foreignNetworkId,
    canonicalBridgeAddress(bridge.foreignAddress),
  ].join(':')

export const createOmnibridgeHarness = () => {
  const base = createCollectorHarness()
  const tokenStore = createTokenStoreHarness()

  const bridges = new Map<string, RecordedBridgeRow>()
  const bridgeLinks: RecordedBridgeLink[] = []
  const erc20Metadata = new Map<string, Erc20Entry>()
  const finalizedBlockByChain = new Map<number, bigint>()
  const chainClients = new Map<number, { getChainId: Mock; getBlock: Mock }>()

  // -- ../db: bridge-specific identity/upsert semantics -------------------

  const insertBridge = vi.fn(async (bridge: InsertableBridge, _tx?: DrizzleTx): Promise<Bridge> => {
    const bridgeId = `bridge:${keccak256(toBytes(bridgeIdentity(bridge))).slice(2)}`
    const existing = bridges.get(bridgeId)
    // Mirrors the real onConflictDoUpdate set clause on the bridge table, which
    // only ever reassigns bridgeId (a no-op) — block-progress/link-order state
    // from a prior write is deliberately preserved, exactly like collector-harness's
    // provider/list/network upserts.
    if (existing) return { ...existing } as unknown as Bridge
    const created: RecordedBridgeRow = {
      bridgeId,
      type: bridge.type,
      providerId: bridge.providerId,
      homeNetworkId: bridge.homeNetworkId,
      homeAddress: canonicalBridgeAddress(bridge.homeAddress),
      foreignNetworkId: bridge.foreignNetworkId,
      foreignAddress: canonicalBridgeAddress(bridge.foreignAddress),
      currentHomeBlockNumber: 0,
      currentForeignBlockNumber: 0,
      bridgeLinkOrderId: 0,
    }
    bridges.set(bridgeId, created)
    return { ...created } as unknown as Bridge
  })

  const getBridge = vi.fn(async (bridgeId: string, _tx?: DrizzleTx): Promise<Bridge> => {
    const row = bridges.get(bridgeId)
    if (!row) {
      throw new Error(`omnibridge-harness: no bridge found for id "${bridgeId}" — call insertBridge first.`)
    }
    return { ...row } as unknown as Bridge
  })

  const updateBridgeBlockProgress = vi.fn(
    async (bridgeId: string, updates: Partial<Bridge>, _tx?: DrizzleTx): Promise<void> => {
      const row = bridges.get(bridgeId)
      if (!row) {
        throw new Error(`omnibridge-harness: no bridge found for id "${bridgeId}" — call insertBridge first.`)
      }
      Object.assign(row, updates)
    },
  )

  const insertBridgeLink = vi.fn(async (bridgeLink: InsertableBridgeLink, _tx?: DrizzleTx) => {
    const bridgeLinkId = `bridge-link:${keccak256(
      toBytes(`${bridgeLink.nativeTokenId}${bridgeLink.bridgedTokenId}${bridgeLink.bridgeId}`),
    ).slice(2)}`
    const created: RecordedBridgeLink = {
      bridgeLinkId,
      bridgeId: bridgeLink.bridgeId,
      nativeTokenId: bridgeLink.nativeTokenId,
      bridgedTokenId: bridgeLink.bridgedTokenId,
      transactionHash: bridgeLink.transactionHash,
    }
    bridgeLinks.push(created)
    return created
  })

  const dbModule = {
    insertProvider: base.dbModule.insertProvider,
    insertList: base.dbModule.insertList,
    insertNetworkFromChainId: base.dbModule.insertNetworkFromChainId,
    transaction: base.dbModule.transaction,
    storeToken: tokenStore.storeToken,
    insertListToken: tokenStore.insertListToken,
    insertBridge,
    getBridge,
    updateBridgeBlockProgress,
    insertBridgeLink,
  }

  // -- ../utils -------------------------------------------------------------

  const clientFor = (chainId: number) => {
    let client = chainClients.get(chainId)
    if (!client) {
      client = {
        getChainId: vi.fn(async () => chainId),
        getBlock: vi.fn(async () => ({ number: finalizedBlockByChain.get(chainId) ?? 0n })),
      }
      chainClients.set(chainId, client)
    }
    return client
  }

  const chainToPublicClient = vi.fn((chain: { id: number }) => clientFor(chain.id))

  const utilsModule = {
    chainIdToNetworkId: base.utilsModule.chainIdToNetworkId,
    counterId: base.utilsModule.counterId,
    chainToPublicClient,
    terminal: base.utilsModule.terminal,
  }

  // -- @gibs/utils ------------------------------------------------------------

  const erc20Read = vi.fn(
    async (_chain: unknown, _client: unknown, address: string, _opts?: { signal?: AbortSignal }) => {
      const entry = erc20Metadata.get(address.toLowerCase())
      if (entry === undefined) {
        throw new Error(
          `omnibridge-harness: no queued erc20 metadata for "${address}" — call harness.setErc20Metadata first.`,
        )
      }
      if (entry instanceof Error) throw entry
      if (typeof entry === 'function') return entry()
      return entry
    },
  )

  const gibsUtilsModule = { erc20Read }

  // -- viem.getContract(...).getEvents.NewTokenRegistered -------------------
  //
  // `collectByBridgeConfig` builds one contract instance per direction, always
  // targeting `toConfig.address` — home→foreign scans the *foreign* contract,
  // foreign→home scans the *home* contract. Keying the fake `getEvents` by
  // address (rather than one shared mock) lets a test drive each direction's
  // paging/error behavior independently, exactly like production traffic to
  // two different contracts would.

  const eventsMocksByAddress = new Map<string, Mock>()

  const getEventsMockFor = (address: string): Mock => {
    const key = address.toLowerCase()
    let mock = eventsMocksByAddress.get(key)
    if (!mock) {
      mock = vi.fn(async () => [])
      eventsMocksByAddress.set(key, mock)
    }
    return mock
  }

  const getContract = vi.fn(({ address }: { address: string }) => ({
    getEvents: { NewTokenRegistered: getEventsMockFor(address) },
  }))

  // -- ../utils/delay ---------------------------------------------------------

  const delayMock = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined)

  const reset = () => {
    base.reset()
    tokenStore.reset()
    bridges.clear()
    bridgeLinks.length = 0
    erc20Metadata.clear()
    finalizedBlockByChain.clear()
    chainClients.clear()
    eventsMocksByAddress.clear()
    getContract.mockClear()
    delayMock.mockReset()
    delayMock.mockImplementation(async () => undefined)
  }
  delayMock.mockImplementation(async () => undefined)

  return {
    state: {
      providers: base.state.providers,
      lists: base.state.lists,
      networks: base.state.networks,
      bridges,
      bridgeLinks,
      tokens: tokenStore.state.tokens,
      listTokens: tokenStore.state.listTokens,
    },
    dbModule,
    utilsModule,
    gibsUtilsModule,
    getContract,
    getEventsMockFor,
    delayMock,
    clientFor,
    /** Registers the `[name, symbol, decimals]` (or an `Error`, or a side-effecting thunk) an `erc20Read(chain, client, address)` call should resolve to for `address`. */
    setErc20Metadata: (address: string, entry: Erc20Entry) => erc20Metadata.set(address.toLowerCase(), entry),
    /** Registers the block number `chainToPublicClient(chain).getBlock({ blockTag: 'finalized' })` should resolve to for `chainId`. */
    setFinalizedBlock: (chainId: number, blockNumber: bigint) => finalizedBlockByChain.set(chainId, blockNumber),
    /** Looks up a bridge's current recorded state by its identity fields — handy for asserting persisted paging progress. */
    findBridge: (bridge: InsertableBridge) =>
      bridges.get(`bridge:${keccak256(toBytes(bridgeIdentity(bridge))).slice(2)}`),
    reset,
  }
}

export type OmnibridgeHarness = ReturnType<typeof createOmnibridgeHarness>

/**
 * The instance every `omnibridge.ts` test should import and hand to
 * `vi.mock()`. A plain exported singleton, not something built inside
 * `vi.hoisted()` — see `collector-harness.ts`'s doc comment for why.
 */
export const omnibridgeHarness: OmnibridgeHarness = createOmnibridgeHarness()
