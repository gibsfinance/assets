import * as types from '@/types'
import * as db from '@/db'
import * as utils from '@/utils'
import type { List, Network, Provider } from 'knex/types/tables'

export const collect = async (providerKey: string, listKey: string, tokenList: types.TokenList) => {
  // let completed = 0
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
      provider = await db.insertProvider(
        {
          key: providerKey,
        },
        tx,
      )
      list = await db.insertList(
        {
          providerId: provider.providerId,
          networkId: utils.chainIdToNetworkId(chainIds.length === 1 ? chainIds[0] : 0),
          name: tokenList.name,
          key: listKey,
          default: true,
          description: '',
          ...(tokenList.version || {}),
        },
        tx,
      )
      await db.fetchImageAndStoreForList(
        {
          listId: list.listId,
          uri: tokenList.logoURI || null,
          originalUri: tokenList.logoURI || null,
          providerKey,
        },
        tx,
      )
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
      const blacklist = new Set<string>(['missing_large.png', 'missing_thumb.png'])
      await db.transaction(async (tx) => {
        if (blacklist.has(entry.logoURI as string)) {
          entry.logoURI = ''
        }
        const path = entry.logoURI?.replace('hhttps://', 'https://') || null
        await db.fetchImageAndStoreForToken(
          {
            listId: list.listId,
            uri: path,
            originalUri: path,
            providerKey,
            token,
          },
          tx,
        )
        // completed++
      })
    }
  })
  // console.log('completed %o %o/%o',
  //   providerKey, completed, tokenList.tokens.length,
  // )
}
