import * as types from '@/types'
import * as viem from 'viem'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { fetch } from '@/fetch'
import * as db from '@/db'
import * as utils from '@/utils'
import _ from 'lodash'

type Extension = {
  address: viem.Hex
  logoURI: string
  network: {
    id: number
    isNetworkImage: boolean
  }
}

type Input = {
  extension?: Extension[]
  providerKey: string
  tokenList: string
  listKey: string
  isDefault?: boolean
}

export const collect =
  ({ providerKey, listKey, tokenList: tokenListUrl, extension, isDefault = true }: Input) =>
  async () => {
    const tokenList = await fetch(tokenListUrl).then((res): Promise<types.TokenList> => res.json())
    const extra = extension || []
    const extras = await Promise.all(
      extra.map(async (item) => {
        // extension
        const chain = utils.findChain(item.network.id) as viem.Chain
        const client = viem.createPublicClient({
          chain,
          transport: viem.http(),
        })
        const [image, [name, symbol, decimals]] = await Promise.all([
          db.fetchImage(item.logoURI, providerKey),
          utils.erc20Read(chain, client, item.address),
        ])
        if (!image) {
          return
        }
        const network = await db.insertNetworkFromChainId(item.network.id)
        if (item.network.isNetworkImage) {
          await db.fetchImageAndStoreForNetwork({
            chainId: item.network.id,
            uri: image,
            originalUri: item.logoURI,
            providerKey,
          })
        }
        await db.fetchImageAndStoreForToken({
          listId: null,
          uri: image,
          originalUri: item.logoURI,
          providerKey,
          token: {
            name,
            symbol,
            decimals,
            providedId: item.address,
            networkId: network.networkId,
          },
        })
        return {
          chainId: item.network.id,
          uri: item.logoURI,
          name,
          symbol,
          decimals,
          address: item.address,
        }
      }),
    )
    tokenList.tokens.push(..._.compact(extras))
    return inmemoryTokenlist.collect(providerKey, listKey, tokenList, isDefault)
  }
