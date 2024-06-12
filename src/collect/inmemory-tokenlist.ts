import * as types from '@/types'
import * as db from '@/db'
import * as utils from '@/utils'
import type { List, Network, Provider } from 'knex/types/tables'

export const collect = async (providerKey: string, listKey: string, tokenList: types.TokenList) => {
  let completed = 0
  const chainIdSet = new Set<number>()
  for (const entry of tokenList.tokens) {
    chainIdSet.add(+entry.chainId)
  }
  const chainIds = [...chainIdSet.values()]
  const networks = new Map<number, Network>()
  await utils.spinner(providerKey, async () => {
    let provider!: Provider
    let list!: List
    await db.transaction(async (tx) => {
      await db.insertNetworkFromChainId(0, undefined, tx)
      for (const chainId of chainIds) {
        if (chainId) {
          const network = await db.insertNetworkFromChainId(chainId, undefined, tx)
          networks.set(chainId, network)
        }
      }
      provider = await db.insertProvider({
        key: providerKey,
      }, tx)
      list = await db.insertList({
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(chainIds.length === 1 ? chainIds[0] : 0),
        name: tokenList.name,
        key: listKey,
        default: true,
        description: '',
        ...(tokenList.version || {}),
      }, tx)
      if (tokenList.logoURI) {
        await db.fetchImageAndStoreForList({
          listId: list.listId,
          uri: tokenList.logoURI,
          originalUri: tokenList.logoURI,
          providerKey,
        }, tx)
      }
    })
    for (const entry of tokenList.tokens) {
      const network = networks.get(entry.chainId)!
      const token = {
        name: entry.name,
        symbol: entry.symbol,
        decimals: entry.decimals,
        networkId: network.networkId,
        providedId: entry.address,
      }
      await db.transaction(async (tx) => {
        if (!entry.logoURI || entry.logoURI === 'missing_large.png' || entry.logoURI === 'missing_thumb.png') {
          await db.insertToken(token, tx)
          return entry
        }
        const path = entry.logoURI.replace('hhttps://', 'https://')
        await db.fetchImageAndStoreForToken({
          listId: list.listId,
          uri: path,
          originalUri: path,
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
