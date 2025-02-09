import * as viem from 'viem'
import * as db from '@/db'
import { chainIdToNetworkId, erc20Read, publicClient } from '@/utils'
import _ from 'lodash'
import { log } from '@/logger'

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
export const collect = (config: BridgeConfig[]) => async () => {
  await Promise.all(config.map(collectByBridgeConfig))
}

const abi = viem.parseAbi(['event NewTokenRegistered(address indexed native, address indexed bridged)'])

export const collectByBridgeConfig = async (config: BridgeConfig) => {
  await Promise.all(
    [config.home, config.foreign].map(async (fromConfig) => {
      let key = `${config.providerPrefix}-bridge`
      if (config.testnetPrefix) {
        key = `testnet-${config.testnetPrefix}-${key}`
      }
      const fromHome = fromConfig === config.home
      const toConfig = fromHome ? config.foreign : config.home
      // console.log('todo: %o from=%o to=%o', config.providerPrefix, fromConfig.chain.id, toConfig.chain.id)
      const fromClient = publicClient(fromConfig.chain)
      const toClient = publicClient(toConfig.chain)
      const toOmnibridge = viem.getContract({
        address: toConfig.address,
        client: toClient,
        abi,
      })
      let fromBlock = BigInt(toConfig.startBlock)
      const latestBlock = await toClient.getBlock({
        blockTag: 'latest',
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
      })
    }),
  )
}

const iterateOverRange = async (
  start: bigint,
  end: bigint,
  iterator: (a: bigint, b: bigint) => Promise<void>,
  step = 1_000n,
) => {
  let fromBlock = start
  do {
    let toBlock = fromBlock + step
    if (toBlock > end) {
      toBlock = end
    }
    await iterator(fromBlock, toBlock)
    fromBlock = toBlock
  } while (end > fromBlock)
}
