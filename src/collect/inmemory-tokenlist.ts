import * as types from '@/types'
import * as db from '@/db'
import * as utils from '@/utils'

export const collect = async (providerKey: string, tokenList: types.TokenList) => {
  return utils.spinner(providerKey, async () => {
    const provider = await db.insertProvider({
      key: providerKey,
    })
    await db.insertNetworkFromChainId(0)
    const list = await db.insertList({
      providerId: provider.providerId,
      networkId: utils.chainIdToNetworkId(0),
      name: tokenList.name,
      description: '',
    })
    await db.fetchImageAndStoreForList({
      listId: list.listId,
      uri: tokenList.logoURI,
      originalUri: tokenList.logoURI,
      providerKey,
    })
    await utils.limit.map(tokenList.tokens, async (entry: types.TokenEntry) => {
      if (!entry.logoURI) {
        return entry
      }
      const network = await db.insertNetworkFromChainId(entry.chainId)
      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: entry.logoURI,
        originalUri: entry.logoURI,
        providerKey,
        token: {
          name: entry.name,
          symbol: entry.symbol,
          decimals: entry.decimals,
          networkId: network.networkId,
          providedId: entry.address,
        }
      })
    })
  })
}
