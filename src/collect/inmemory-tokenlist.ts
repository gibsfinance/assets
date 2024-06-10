import * as types from '@/types'
import * as db from '@/db'
import * as utils from '@/utils'

export const collect = async (providerKey: string, tokenList: types.TokenList) => {
  let completed = 0
  await utils.spinner(providerKey, async () => {
    const provider = await db.insertProvider({
      key: providerKey,
    })
    await db.insertNetworkFromChainId(0)
    const list = await db.insertList({
      providerId: provider.providerId,
      networkId: utils.chainIdToNetworkId(0),
      name: tokenList.name,
      description: '',
      ...(tokenList.version || {}),
    })
    await db.fetchImageAndStoreForList({
      listId: list.listId,
      uri: tokenList.logoURI,
      originalUri: tokenList.logoURI,
      providerKey,
    })
    await utils.limit.map(tokenList.tokens, async (entry: types.TokenEntry) => {
      const network = await db.insertNetworkFromChainId(entry.chainId)
      const token = {
        name: entry.name,
        symbol: entry.symbol,
        decimals: entry.decimals,
        networkId: network.networkId,
        providedId: entry.address,
      }
      if (!entry.logoURI) {
        await db.insertToken(token).catch((err) => {
          console.log(provider, list.listId, token)
          throw err
        })
        return entry
      }
      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: entry.logoURI,
        originalUri: entry.logoURI,
        providerKey,
        token,
      })
      completed++
    })
  })
  console.log('completed %o %o/%o',
    providerKey, completed, tokenList.tokens.length,
  )
}
