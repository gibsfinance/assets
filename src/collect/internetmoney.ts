import * as chains from 'viem/chains'
import * as viem from 'viem'
import * as utils from '@/utils'
import type { InternetMoneyNetwork, Todo } from '@/types'
import { fetch } from '@/fetch'
import * as db from '@/db'
import type { List, Provider } from 'knex/types/tables'
import promiseLimit from 'promise-limit'

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
      await db.insertProvider({
        name: 'Internet Money',
        key: 'internetmoney',
      }, tx)
      await db.insertNetworkFromChainId(0, undefined, tx)
      insertedList = await db.insertList({
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(0),
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
        todos.push(async () => {
          await db.transaction(async (tx) => {
            await db.fetchImageAndStoreForList({
              listId: insertedList.listId,
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
              await db.fetchImageAndStoreForToken({
                listId: insertedList.listId,
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
