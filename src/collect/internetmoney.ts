import * as chains from 'viem/chains'
import * as viem from 'viem'
import * as utils from '@/utils'
import type { InternetMoneyNetwork, Todo } from '@/types'
import { fetch } from '@/fetch'
import * as db from '@/db'
import type { List, Provider } from 'knex/types/tables'
import promiseLimit from 'promise-limit'
import { Tx } from '@/db/tables'

const baseUrl = 'https://im-wallet.herokuapp.com/api/v1/networks'

export const collect = async () => {
  return await utils.spinner('internetmoney', async () => {
    const json = await fetch(baseUrl).then((res): Promise<InternetMoneyNetwork[]> => res.json())
    const todos: Todo[] = []
    const encounteredChainIds = new Set<bigint>()
    let provider!: Provider
    let insertedList!: List
    await db.transaction(async (tx) => {
      provider = await db.insertProvider({
        name: 'Internet Money',
        key: 'internetmoney',
      }, tx)
      await db.insertNetworkFromChainId(0, undefined, tx)
      insertedList = await db.insertList({
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(0),
        key: 'wallet',
        name: 'default wallet list',
        description: 'the list that loads by default in the wallet',
      }, tx)
    })
    for (const network of json) {
      let chain = utils.findChain(network.chainId)
      if (!chain) {
        chain = {
          id: network.chainId,
          contracts: chains.mainnet.contracts,
          rpcUrls: {
            default: {
              http: [network.rpc],
            },
          },
        } as unknown as viem.Chain
      }
      await db.insertNetworkFromChainId(chain.id);
      ; ((network) => {
        const client = viem.createClient({
          transport: viem.http(),
          chain,
        })
        encounteredChainIds.add(BigInt(chain.id))
        const insertAndGetNetworkList = (t: Tx) => {
          return db.insertList({
            providerId: provider.providerId,
            networkId: utils.chainIdToNetworkId(chain.id),
            key: `wallet-${chain.id}`,
            name: `default wallet list for chain ${chain.id}`,
            description: `the list that loads by default in the wallet for ${chain.id}`,
          }, t)
        }
        todos.push(async () => {
          await db.transaction(async (tx) => {
            const networkList = await insertAndGetNetworkList(tx)
            await db.fetchImageAndStoreForList({
              listId: networkList.listId,
              uri: network.icon,
              originalUri: network.icon,
              providerKey: provider.key,
            }, tx)
          })
        })
        todos.push(
          ...network.tokens.map((token) => async () => {
            const address = token.address as viem.Hex
            const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)
            await db.transaction(async (tx) => {
              const networkList = await insertAndGetNetworkList(tx)
              const insertion = {
                uri: token.icon,
                originalUri: token.icon,
                providerKey: provider.key,
                token: {
                  symbol,
                  name,
                  decimals,
                  networkId: utils.chainIdToNetworkId(chain.id),
                  providedId: address,
                },
              }
              await db.fetchImageAndStoreForToken({
                ...insertion,
                listId: networkList.listId,
              }, tx)
              await db.fetchImageAndStoreForToken({
                ...insertion,
                listId: insertedList.listId,
              }, tx)
            })
          }),
        )
      })(network)
    }
    const limit = promiseLimit<Todo>(4)
    await limit.map(todos, async (todo) => {
      await utils.retry(todo)
    })
  })
}
