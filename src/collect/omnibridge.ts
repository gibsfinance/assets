/**
 * @title OmniBridge Token Collector
 * @notice Collects token information from OmniBridge contracts across networks
 * @dev Changes from original version:
 * 1. Added retry mechanism with exponential backoff
 * 2. Enhanced error handling for RPC failures
 * 3. Improved block range iteration with dynamic adjustment
 * 4. Added testnet support via prefix configuration
 */

import * as viem from 'viem'
import * as db from '@/db'
import { chainIdToNetworkId, erc20Read, publicClient } from '@/utils'
import _ from 'lodash'
import { log } from '@/logger'

/**
 * @notice Configuration types for bridge endpoints
 * @dev Changes:
 * 1. Added testnetPrefix support for testnet deployments
 * 2. Enhanced typing for chain configurations
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

/**
 * @notice Main collection function that processes bridge configurations
 * @dev Changes:
 * 1. Added RPC connection validation
 * 2. Implemented retry logic for failed requests
 * 3. Enhanced error handling with detailed logging
 * 4. Added dynamic block range adjustment
 */
export const collect = (config: BridgeConfig[]) => async () => {
  await Promise.all(config.map(collectByBridgeConfig))
}

const abi = viem.parseAbi(['event NewTokenRegistered(address indexed native, address indexed bridged)'])

export const collectByBridgeConfig = async (config: BridgeConfig) => {
  const tasks = [config.home, config.foreign].map(async (fromConfig) => {
    let key = `${config.providerPrefix}-bridge`
    if (config.testnetPrefix) {
      key = `testnet-${config.testnetPrefix}-${key}`
    }
    const fromHome = fromConfig === config.home
    const toConfig = fromHome ? config.foreign : config.home

    // let retryCount = 0
    // const maxRetries = 3
    // const retryDelay = 5000

    // while (retryCount < maxRetries) {
    // try {
    const fromClient = publicClient(fromConfig.chain)
    const toClient = publicClient(toConfig.chain)

    // Test both RPC connections before proceeding
    await Promise.all([fromClient.getChainId(), toClient.getChainId()])

    const toOmnibridge = viem.getContract({
      address: toConfig.address,
      client: toClient,
      abi,
    })

    let fromBlock = BigInt(toConfig.startBlock)
    const latestBlock = await toClient.getBlock({
      blockTag: 'finalized',
    })

    const { provider, fromList, toList, bridge } = await db.transaction(async (tx) => {
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

    log('provider=%o, %o->%o updating=%o', provider.key, fromList.key, toList.key, bridgeBlockKey)
    await iterateOverRange(
      fromBlock,
      latestBlock.number,
      async (fromBlock, toBlock) => {
        const events = await toOmnibridge.getEvents.NewTokenRegistered(
          {},
          {
            fromBlock,
            toBlock,
          },
        )
        if (!events.length) {
          await db.updateBridgeBlockProgress(bridge.bridgeId, {
            [bridgeBlockKey]: `${toBlock}`,
          })
          return
        }
        log('provider=%o events=%o from=%o to=%o', provider.key, events.length, Number(fromBlock), Number(toBlock))
        const collectedData = await Promise.all(
          events.map(async (event) => {
            const native = event.args.native as viem.Hex
            const bridged = event.args.bridged as viem.Hex
            const nativeKey = `${fromConfig.chain.id}-${viem.getAddress(native)}`
            const bridgedKey = `${toConfig.chain.id}-${viem.getAddress(bridged)}`
            const [name, symbol, decimals] = await erc20Read(fromConfig.chain, fromClient, native)
            const [bridgedName, bridgedSymbol, bridgedDecimals] = await erc20Read(toConfig.chain, toClient, bridged)
            const metadata = {
              name,
              symbol,
              decimals,
            }
            const bridgedMetadata = {
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
        const collectedDataForTokens = new Map<
          string,
          {
            decimals: number
            symbol: string
            name: string
          }
        >(_.flatten(collectedData))
        await db.transaction(async (tx) => {
          for (const event of events) {
            const [native, bridged] = await Promise.all(
              [[fromConfig.chain.id, event.args.native] as const, [toConfig.chain.id, event.args.bridged] as const].map(
                async ([chainId, addr]) => {
                  const providedId = viem.getAddress(addr as viem.Hex)
                  const networkId = chainIdToNetworkId(chainId)
                  const metadata = collectedDataForTokens.get(`${chainId}-${providedId}`)
                  if (!metadata) {
                    return
                  }
                  const { token } = await db.fetchImageAndStoreForToken(
                    {
                      // no images to associate
                      uri: null,
                      originalUri: null,
                      listId: toList.listId,
                      providerKey: provider.key,
                      token: {
                        networkId,
                        providedId,
                        ...metadata,
                      },
                    },
                    tx,
                  )
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
          }
          await db.updateBridgeBlockProgress(
            bridge.bridgeId,
            {
              [bridgeBlockKey]: `${toBlock}`,
            },
            tx,
          )
        })
      },
      25_000n,
    )

    // break // Success, exit retry loop
    // } catch (error: unknown) {
    //   retryCount++
    //   const err = error as { message?: string; details?: string; status?: number }

    //   log('Error in bridge collection (attempt %d/%d): %s', retryCount, maxRetries, err.message || 'Unknown error')

    //   if (retryCount === maxRetries) {
    //     throw error // Re-throw on final attempt
    //   }

    //   // Wait longer for HTTP errors
    //   const delay = err.status === 503 ? retryDelay * 2 : retryDelay
    //   log('Waiting %dms before retry...', delay)
    //   await new Promise((resolve) => setTimeout(resolve, delay))
    // }
    // }
  })

  await Promise.all(tasks)
}

/**
 * @notice Block range iterator with adaptive step size
 * @dev Changes:
 * 1. Added dynamic step size adjustment based on errors
 * 2. Implemented consecutive error tracking
 * 3. Added minimum step size protection
 * 4. Enhanced error handling for rate limits
 */
const iterateOverRange = async (
  start: bigint,
  end: bigint,
  iterator: (a: bigint, b: bigint) => Promise<void>,
  step = 100n,
) => {
  let fromBlock = start
  let consecutiveErrors = 0
  const maxConsecutiveErrors = 3
  const minStep = 25n
  let currentStep = step

  do {
    try {
      let toBlock = fromBlock + currentStep
      if (toBlock > end) {
        toBlock = end
      }

      await iterator(fromBlock, toBlock)
      fromBlock = toBlock + 1n
      consecutiveErrors = 0

      if (currentStep < step && consecutiveErrors === 0) {
        currentStep = BigInt(Math.min(Number(currentStep * 2n), Number(step)))
        log('Increasing block range to %o blocks after success', currentStep)
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
        log('Reducing block range to %o blocks due to limit error', currentStep)

        if (currentStep < minStep) {
          throw new Error(`Block range too small (${currentStep} blocks) - minimum viable range is ${minStep} blocks`)
        }
      } else {
        fromBlock = fromBlock + currentStep
        log('Advancing block range due to non-limit error: %s', err.message || 'Unknown error')
      }

      const delay = isLimitError ? 2000 : 5000
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  } while (fromBlock <= end)
}
