import * as db from '@/db'
import { chainIdToNetworkId, erc20Read, chainToPublicClient } from '@/utils'
import _ from 'lodash'
import * as viem from 'viem'

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

/**
 * Main collection function that processes bridge configurations
 */
export const collect = (config: BridgeConfig[]) => async () => {
  // updateStatus({
  //   provider: 'omnibridge',
  //   message: 'Starting bridge collection...',
  //   phase: 'setup',
  // } satisfies StatusProps)

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
    const fromClient = chainToPublicClient(fromConfig.chain)
    const toClient = chainToPublicClient(toConfig.chain)

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

    // log('provider=%o, %o->%o updating=%o', provider.key, fromList.key, toList.key, bridgeBlockKey)
    await iterateOverRange(fromBlock, latestBlock.number, async (fromBlock, toBlock) => {
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
      // log('provider=%o events=%o from=%o to=%o', provider.key, events.length, Number(fromBlock), Number(toBlock))
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
    })
  }, 10_000n)

  await Promise.all(tasks)
}

/**
 * Block range iterator with adaptive step size
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

      const delay = isLimitError ? 2000 : 5000
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  } while (fromBlock <= end)
}
