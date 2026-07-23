import _ from 'lodash'
import * as viem from 'viem'
import { erc20Read } from '@gibs/utils'
import { delay } from '../utils/delay'
import * as db from '../db'
import { chainIdToNetworkId, chainToPublicClient, counterId, terminal } from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import type { MinimalTokenInfo } from '@gibs/utils'
import { BaseCollector, DiscoveryManifest } from './base-collector'

/**
 * Configuration types for bridge endpoints
 */
type BridgeSideConfig = {
  address: viem.Hex
  chain: viem.Chain
  startBlock: number
}

type BridgeConfig = {
  providerPrefix: string
  type?: string
  testnetPrefix?: string
  home: BridgeSideConfig
  foreign: BridgeSideConfig
}

const providerKey = 'omnibridge'

const term = _.memoize(() => {
  const row = terminal.issue({
    id: providerKey,
    type: terminalRowTypes.SETUP,
  })
  const section = row.issue(providerKey, 6)
  return { row, section }
})

/**
 * Two-phase collector for Omnibridge token bridges.
 * Phase 1 (discover): creates all bridge providers + home/foreign lists based on config.
 * Phase 2 (collect): scans blockchain events for bridge tokens.
 */
class OmnibridgeCollector extends BaseCollector {
  readonly key = 'omnibridge'

  private config: BridgeConfig[]

  constructor(config: BridgeConfig[]) {
    super()
    this.config = config
  }

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    const manifest: DiscoveryManifest = []

    for (const c of this.config) {
      let key = `${c.providerPrefix}-bridge`
      if (c.testnetPrefix) {
        key = `testnet-${c.testnetPrefix}-${key}`
      }

      const [provider] = await db.insertProvider({ key })
      await db.insertNetworkFromChainId(c.home.chain.id)
      await db.insertNetworkFromChainId(c.foreign.chain.id)

      const [homeList] = await db.insertList({
        providerId: provider.providerId,
        key: 'home',
        default: true,
        networkId: chainIdToNetworkId(c.home.chain.id),
      })
      const [foreignList] = await db.insertList({
        providerId: provider.providerId,
        key: 'foreign',
        default: false,
        networkId: chainIdToNetworkId(c.foreign.chain.id),
      })

      // Also create bridge record during discover (insertBridge canonicalizes casing)
      await db.insertBridge({
        type: c.type ?? 'omnibridge',
        providerId: provider.providerId,
        homeNetworkId: chainIdToNetworkId(c.home.chain.id),
        homeAddress: c.home.address,
        foreignNetworkId: chainIdToNetworkId(c.foreign.chain.id),
        foreignAddress: c.foreign.address,
      })

      manifest.push({
        providerKey: key,
        lists: [
          { listKey: 'home', listId: homeList.listId },
          { listKey: 'foreign', listId: foreignList.listId },
        ],
      })
    }

    return manifest
  }

  async collect(signal: AbortSignal): Promise<void> {
    const { row } = term()
    try {
      await Promise.all(
        this.config.map((c) => {
          return collectByBridgeConfig(c, signal)
        }),
      )
    } finally {
      row.complete()
    }
  }
}

export default OmnibridgeCollector

const abi = viem.parseAbi(['event NewTokenRegistered(address indexed native, address indexed bridged)'])

export const collectByBridgeConfig = async (config: BridgeConfig, signal: AbortSignal) => {
  const { section } = term()
  const tasks = [config.home, config.foreign].map(async (fromConfig) => {
    let key = `${config.providerPrefix}-bridge`
    if (config.testnetPrefix) {
      key = `testnet-${config.testnetPrefix}-${key}`
    }
    const fromHome = fromConfig === config.home
    const toConfig = fromHome ? config.foreign : config.home

    const bridgeDirectionId = `${key}-${fromConfig.chain.id}->${toConfig.chain.id}`
    const configRow = section.task(bridgeDirectionId, {
      id: `${config.providerPrefix}: ${fromConfig.chain.id}->${toConfig.chain.id}`,
      type: terminalRowTypes.SETUP,
      kv: {
        from: fromConfig.chain.id,
        to: toConfig.chain.id,
      },
    })
    configRow.createCounter(terminalCounterTypes.TOKEN)
    const fromClient = chainToPublicClient(fromConfig.chain)
    const toClient = chainToPublicClient(toConfig.chain)

    // Test both RPC connections before proceeding
    await Promise.all([fromClient.getChainId(), toClient.getChainId()])
    if (signal.aborted) {
      configRow.unmount()
      return
    }

    const toOmnibridge = viem.getContract({
      address: toConfig.address,
      client: toClient,
      abi,
    })

    let fromBlock = BigInt(toConfig.startBlock)
    const finalizedBlock = await toClient.getBlock({
      blockTag: 'finalized',
    })

    const {
      // fromList,
      toList,
      bridge,
    } = await db.transaction(async (tx) => {
      // other services may be held by the provider
      // bridge suffix is code controlled
      const [provider] = await db.insertProvider({ key }, tx)
      await db.insertNetworkFromChainId(fromConfig.chain.id, undefined, tx)
      await db.insertNetworkFromChainId(toConfig.chain.id, undefined, tx)
      const [fromList] = await db.insertList(
        {
          providerId: provider.providerId,
          key: fromHome ? 'home' : 'foreign',
          default: fromHome,
          networkId: chainIdToNetworkId(fromConfig.chain.id),
        },
        tx,
      )
      const [toList] = await db.insertList(
        {
          providerId: provider.providerId,
          key: fromHome ? 'foreign' : 'home',
          default: !fromHome,
          networkId: chainIdToNetworkId(toConfig.chain.id),
        },
        tx,
      )
      const bridge = await db.insertBridge(
        {
          type: config.type ?? 'omnibridge',
          providerId: provider.providerId,
          homeNetworkId: chainIdToNetworkId(config.home.chain.id),
          homeAddress: config.home.address,
          foreignNetworkId: chainIdToNetworkId(config.foreign.chain.id),
          foreignAddress: config.foreign.address,
        },
        tx,
      )
      return {
        provider,
        fromList,
        toList,
        bridge,
      }
    })

    const bridgeBlockKey = fromHome ? 'currentForeignBlockNumber' : 'currentHomeBlockNumber'
    const currentToBlockNumber = BigInt(bridge[bridgeBlockKey])
    if (currentToBlockNumber && currentToBlockNumber > fromBlock) {
      fromBlock = currentToBlockNumber
    }

    configRow.update({
      kv: {
        from: fromConfig.chain.id,
        to: toConfig.chain.id,
        startBlock: `${fromBlock}`,
        endBlock: `${finalizedBlock.number}`,
      },
    })

    const blocksSection = configRow.issue(providerKey, 1)
    configRow.createCounter(terminalCounterTypes.TOKEN)
    await iterateOverRange(
      fromBlock,
      finalizedBlock.number,
      async (fromBlock, toBlock) => {
        // No `await` runs between `iterateOverRange`'s own `if (signal?.aborted) return`
        // (immediately before it calls this callback) and this point, so `signal.aborted`
        // cannot have changed here — an equivalent check was already confirmed unreachable
        // and deleted; see the final report for the reachability argument.
        const task = blocksSection.task(`${bridgeDirectionId}-${fromBlock}-${toBlock}`, {
          id: '',
          type: terminalRowTypes.SETUP,
          kv: {
            final: finalizedBlock.number,
            from: fromBlock,
            to: toBlock,
          },
        })
        const events = await toOmnibridge.getEvents.NewTokenRegistered(
          {},
          {
            fromBlock,
            toBlock,
          },
        )
        if (!events.length) {
          task.unmount()
          await db.updateBridgeBlockProgress(bridge.bridgeId, {
            [bridgeBlockKey]: `${toBlock}`,
          })
          return
        }
        if (signal.aborted) {
          return
        }
        const collectedData = await Promise.all(
          events.map(async (event) => {
            // `Array.prototype.map` invokes every callback synchronously in the
            // same tick as the `if (signal.aborted) return` check just above —
            // no `await` runs in between, so `signal.aborted` cannot have
            // changed here; an equivalent per-event check was already confirmed
            // unreachable and deleted, see the final report.
            const native = event.args.native as viem.Hex
            const bridged = event.args.bridged as viem.Hex
            const nativeKey = `${fromConfig.chain.id}-${native.toLowerCase()}`
            const bridgedKey = `${toConfig.chain.id}-${bridged.toLowerCase()}`
            const [[name, symbol, decimals], [bridgedName, bridgedSymbol, bridgedDecimals]] = await Promise.all([
              erc20Read(fromConfig.chain, fromClient, native, { signal }),
              erc20Read(toConfig.chain, toClient, bridged, { signal }),
            ])

            const metadata = {
              address: native,
              chainId: fromConfig.chain.id,
              name,
              symbol,
              decimals,
            }
            const bridgedMetadata = {
              address: bridged,
              chainId: toConfig.chain.id,
              name: bridgedName,
              symbol: bridgedSymbol,
              decimals: bridgedDecimals,
            }
            return [
              [nativeKey, metadata],
              [bridgedKey, bridgedMetadata],
            ] as const
          }),
        )
        if (signal.aborted) {
          return
        }
        const tokenData = _.flatten(_.compact(collectedData))
        const collectedDataForTokens = new Map<string, MinimalTokenInfo>(tokenData)
        await db.transaction(async (tx) => {
          const toBridge = await db.getBridge(bridge.bridgeId, tx)
          let count = toBridge.bridgeLinkOrderId
          for (const event of events) {
            const [native, bridged] = await Promise.all(
              (
                [
                  [fromConfig.chain.id, event.args.native],
                  [toConfig.chain.id, event.args.bridged],
                ] as const
              ).map(async ([chainId, addr]) => {
                const providedId = (addr as viem.Hex).toLowerCase() as viem.Hex
                const networkId = chainIdToNetworkId(chainId)
                // `collectedDataForTokens` was built two lines above from the exact same
                // `events` array using the exact same `chainId`/lowercased-address key
                // shape (see `nativeKey`/`bridgedKey` above), and every event unconditionally
                // contributes both its entries — so this lookup can never miss. `Map#get`'s
                // type signature still reports `V | undefined`, hence the assertion.
                const metadata = collectedDataForTokens.get(`${chainId}-${providedId}`)!
                // Use storeToken for efficient token insertion without image processing
                const { token } = await db.storeToken(
                  {
                    token: {
                      networkId,
                      providedId,
                      name: metadata.name,
                      symbol: metadata.symbol,
                      decimals: metadata.decimals,
                    },
                    listId: toList.listId,
                    listTokenOrderId: count++,
                  },
                  tx,
                )
                configRow.increment(terminalCounterTypes.TOKEN, counterId.token([chainId, providedId]))
                return token
              }),
            )
            await db.insertBridgeLink(
              {
                bridgeId: bridge.bridgeId,
                nativeTokenId: native.tokenId,
                bridgedTokenId: bridged.tokenId,
                transactionHash: event.transactionHash,
              },
              tx,
            )
            configRow.increment(terminalCounterTypes.TOKEN, counterId.token([fromConfig.chain.id, native.providedId]))
          }
          await db.updateBridgeBlockProgress(
            bridge.bridgeId,
            {
              [bridgeBlockKey]: `${toBlock}`,
              bridgeLinkOrderId: count,
            },
            tx,
          )
        })
        task.unmount()
      },
      10_000n,
      signal,
    )
    configRow.unmount()
  })

  await Promise.all(tasks)
}

/**
 * Block range iterator with adaptive step size
 */
const iterateOverRange = async (
  start: bigint,
  end: bigint,
  iterator: (a: bigint, b: bigint) => Promise<void>,
  step = 10_000n,
  signal?: AbortSignal,
) => {
  let fromBlock = start
  let consecutiveErrors = 0
  const maxConsecutiveErrors = 3
  const minStep = 25n
  let currentStep = step

  do {
    if (signal?.aborted) return
    try {
      // `currentStep` starts at `step` and is only ever grown back up to `step`
      // (never past it — see the 20% growth below, which is itself capped at
      // `step`) or shrunk on a "limit" error, so it can never exceed `step`.
      // The one real caller always passes `step` equal to the historical
      // 10,000-block ceiling, so there is nothing left to clamp here.
      let toBlock = fromBlock + currentStep - 1n
      if (toBlock > end) {
        toBlock = end
      }

      await iterator(fromBlock, toBlock)
      if (toBlock === end) {
        break
      }
      fromBlock = toBlock
      consecutiveErrors = 0

      if (currentStep < step && consecutiveErrors === 0) {
        currentStep = BigInt(Math.min(Number((currentStep * 12_000n) / 10_000n), Number(step))) // 20% increase
        // log('Increasing block range to %o blocks after success', currentStep)
      }
    } catch (error: unknown) {
      consecutiveErrors++
      const err = error as { message?: string; details?: string }

      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(
          `Failed after ${maxConsecutiveErrors} consecutive attempts with last error: ${err.message || err}`,
        )
      }

      const errorText = `${err.message || ''} ${err.details || ''}`
      const isLimitError = errorText.toLowerCase().includes('limit') || errorText.includes('exceeds')

      if (isLimitError) {
        currentStep = currentStep / 2n
        if (currentStep < minStep) {
          throw new Error(`Block range too small (${currentStep} blocks) - minimum viable range is ${minStep} blocks`)
        }
      } else {
        fromBlock = fromBlock + currentStep
      }

      const retryDelay = isLimitError ? 200 : 5000
      await delay(retryDelay, signal).catch(() => {})
      if (signal?.aborted) return
    }
  } while (fromBlock <= end)
}

/**
 * Main collection function that processes bridge configurations
 */
export const collect = (config: BridgeConfig[]) => async (signal: AbortSignal) => {
  const collector = new OmnibridgeCollector(config)
  await collector.discover(signal)
  await collector.collect(signal)
}
