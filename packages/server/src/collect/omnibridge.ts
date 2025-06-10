import _ from 'lodash'
import * as viem from 'viem'
import { erc20Read } from '@gibs/utils/viem'
import * as db from '../db'
import { chainIdToNetworkId, chainToPublicClient, counterId, terminal } from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import type { MinimalTokenInfo } from '@gibs/utils'

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
 * Main collection function that processes bridge configurations
 */
export const collect = (config: BridgeConfig[]) => async (signal: AbortSignal) => {
  const { row } = term()
  await Promise.all(
    config.map((c) => {
      return collectByBridgeConfig(c, signal)
    }),
  )
  row.complete()
}

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
      provider,
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
          type: 'omnibridge',
          providerId: provider.providerId,
          homeNetworkId: chainIdToNetworkId(config.home.chain.id),
          homeAddress: viem.getAddress(config.home.address),
          foreignNetworkId: chainIdToNetworkId(config.foreign.chain.id),
          foreignAddress: viem.getAddress(config.foreign.address),
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

    const blocksSection = configRow.issue(providerKey, 1)
    configRow.createCounter(terminalCounterTypes.TOKEN)
    await iterateOverRange(fromBlock, finalizedBlock.number, async (fromBlock, toBlock) => {
      if (signal.aborted) {
        return
      }
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
          if (signal.aborted) {
            return
          }
          const native = event.args.native as viem.Hex
          const bridged = event.args.bridged as viem.Hex
          const nativeKey = `${fromConfig.chain.id}-${viem.getAddress(native)}`
          const bridgedKey = `${toConfig.chain.id}-${viem.getAddress(bridged)}`
          const [
            [name, symbol, decimals],
            [bridgedName, bridgedSymbol, bridgedDecimals],
          ] = await Promise.all([
            erc20Read(fromConfig.chain, fromClient, native),
            erc20Read(toConfig.chain, toClient, bridged),
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
            ([
              [fromConfig.chain.id, event.args.native],
              [toConfig.chain.id, event.args.bridged],
            ] as const).map(
              async ([chainId, addr]) => {
                const providedId = viem.getAddress(addr as viem.Hex)
                const networkId = chainIdToNetworkId(chainId)
                const metadata = collectedDataForTokens.get(`${chainId}-${providedId}`)
                if (!metadata) {
                  return
                }
                // this should not err because we are not storing any image data
                const { token } = await db.fetchImageAndStoreForToken(
                  {
                    // no images to associate
                    uri: null,
                    originalUri: null,
                    listId: toList.listId,
                    providerKey: provider.key,
                    listTokenOrderId: count++,
                    signal,
                    token: {
                      networkId,
                      providedId,
                      name: metadata.name,
                      symbol: metadata.symbol,
                      decimals: metadata.decimals,
                    },
                  },
                  tx,
                )
                configRow.increment(terminalCounterTypes.TOKEN, counterId.token([chainId, providedId]))
                return token
              },
            ),
          )
          if (!native || !bridged) {
            continue
          }
          await db.insertBridgeLink(
            {
              bridgeId: bridge.bridgeId,
              nativeTokenId: native.tokenId,
              bridgedTokenId: bridged.tokenId,
              transactionHash: event.transactionHash,
            },
            tx,
          )
          configRow.increment(
            terminalCounterTypes.TOKEN,
            counterId.token(
              native ? [fromConfig.chain.id, native.providedId] : [toConfig.chain.id, bridged.providedId],
            ),
          )
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
    })
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
) => {
  let fromBlock = start
  let consecutiveErrors = 0
  const maxConsecutiveErrors = 3
  const minStep = 25n
  const maxStep = 10_000n
  let currentStep = step

  do {
    try {
      if (currentStep > maxStep) {
        currentStep = maxStep
      }
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

      const delay = isLimitError ? 200 : 5000
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  } while (fromBlock <= end)
}
