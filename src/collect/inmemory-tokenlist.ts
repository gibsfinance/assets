import * as types from '@/types'
import * as db from '@/db'
import * as utils from '@/utils'
import type { List, Provider } from 'knex/types/tables'

export const collect = async (providerKey: string, tokenList: types.TokenList) => {
  let completed = 0
  await utils.spinner(providerKey, async () => {
    let provider!: Provider
    let list!: List
    await db.transaction(async (tx) => {
      provider = await db.insertProvider({
        key: providerKey,
      }, tx)
      await db.insertNetworkFromChainId(0, undefined, tx)
      list = await db.insertList({
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(0),
        name: tokenList.name,
        description: '',
        ...(tokenList.version || {}),
      }, tx)
      await db.fetchImageAndStoreForList({
        listId: list.listId,
        uri: tokenList.logoURI,
        originalUri: tokenList.logoURI,
        providerKey,
      }, tx)
    })
    for (const entry of tokenList.tokens) {
      await db.transaction(async (tx) => {
        const network = await db.insertNetworkFromChainId(entry.chainId, undefined, tx)
        const token = {
          name: entry.name,
          symbol: entry.symbol,
          decimals: entry.decimals,
          networkId: network.networkId,
          providedId: entry.address,
        }
        if (!entry.logoURI) {
          await db.insertToken(token, tx)
          return entry
        }
        await db.fetchImageAndStoreForToken({
          listId: list.listId,
          uri: entry.logoURI,
          originalUri: entry.logoURI,
          providerKey,
          token,
        }, tx)
        completed++
      })
    }
  })
  // console.log('completed %o %o/%o',
  //   providerKey, completed, tokenList.tokens.length,
  // )
}
