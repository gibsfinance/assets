import * as chains from 'viem/chains'
import * as viem from 'viem'
import * as utils from '@/utils'
import type { InternetMoneyNetwork, Todo } from '@/types'
import { fetch } from '@/fetch'
import * as db from '@/db'
import { tableNames } from '@/db/tables'
import { Provider } from 'knex/types/tables'

const baseUrl = 'https://im-wallet.herokuapp.com/api/v1/networks'

export const collect = async () => {
  return await utils.spinner('internetmoney', async () => {
    const json = await fetch(baseUrl).then((res): Promise<InternetMoneyNetwork[]> => res.json())
    const todos: Todo[] = []
    const encounteredChainIds = new Set<bigint>()
    const [provider] = await db.getDB().from(tableNames.provider)
      .insert<Provider[]>([{
        name: 'Internet Money',
        key: 'internetmoney',
      }])
      .onConflict(['providerId'])
      .merge(['providerId'])
      .returning('*')
    await db.insertProvider({
      name: 'Internet Money',
      key: 'internetmoney',
    })
    await db.insertNetworkFromChainId(0)
    const insertedList = await db.insertList({
      providerId: provider.providerId,
      networkId: utils.chainIdToNetworkId(0),
      name: 'default wallet list',
      description: 'the list that loads by default in the wallet',
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
          transport: viem.http(chain.rpcUrls.default.http[0]),
          chain,
        })
        encounteredChainIds.add(BigInt(chain.id))
        todos.push(async () => {
          await db.fetchImageAndStoreForList({
            listId: insertedList.listId,
            uri: network.icon,
            originalUri: network.icon,
            providerKey: provider.key,
          })
        })
        todos.push(
          ...network.tokens.map((token) => async () => {
            const address = token.address as viem.Hex
            const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)
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
            })
          }),
        )
      })(network)
    }
    await utils.limit.map(todos, (fn) => utils.retry(fn))
  })
}
