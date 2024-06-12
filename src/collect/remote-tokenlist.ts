import * as types from '@/types'
import * as viem from 'viem'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { fetch } from '@/fetch'
import * as db from '@/db';
import * as utils from '@/utils'

type Extension = {
  address: viem.Hex;
  logoURI: string;
  network: {
    id: number;
    isNetworkImage: boolean;
  }
}

type Input = {
  extension?: Extension[];
  providerKey: string;
  tokenList: string
}

export const collect = ({ providerKey, tokenList: tokenListUrl, extension }: Input) => async () => {
  const tokenList = await fetch(tokenListUrl)
    .then((res): Promise<types.TokenList> => res.json())
  await Promise.all((extension || []).map(async (item) => {
    // extension
    const chain = utils.findChain(item.network.id) as viem.Chain
    const client = viem.createPublicClient({
      chain,
      transport: viem.http(),
    })
    const [image, [name, symbol, decimals]] = await Promise.all([
      db.fetchImage(item.logoURI, providerKey),
      utils.erc20Read(chain, client, item.address)
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
  }))
  return inmemoryTokenlist.collect(providerKey, tokenList)
}
