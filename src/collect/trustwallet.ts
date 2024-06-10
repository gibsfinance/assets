import * as fs from 'fs'
import * as db from '@/db'
import * as path from 'path'
import * as utils from '@/utils'
import * as types from '@/types'
import * as viem from 'viem'
import _ from 'lodash'

const providerKey = 'trustwallet'

const blockchainsRoot = path.join(utils.root, 'submodules', 'trustwallet', 'blockchains')
const assetsFolder = 'assets'

export const collect = async () => {
  const blockchainFolders = utils.removedUndesirable(await fs.promises.readdir(blockchainsRoot))
  for (const folder of blockchainFolders) {
    try {
      const f = path.join(blockchainsRoot, folder, assetsFolder)
      await fs.promises.readdir(f).then(async (assets) => {
        await entriesFromAssets(folder, utils.removedUndesirable(assets))
      }).catch((err) => {
        // return null
      })
    } catch (err) {
      console.log(err)
    }
  }
}

const load = async (p: string) => {
  return await Promise.all([
    fs.promises.readFile(path.join(p, 'info.json')).then((info) => JSON.parse(info.toString()) as Info),
    path.join(p, 'logo.png'),
  ])
}

type Link = {
  name: string
  url: string
}

type Info = types.TokenEntry & {
  website?: string
  description?: string
  explorer?: string
  research?: string
  coin_type?: number
  status?: string
  rpc_url?: string
  tags?: string[]
  links: Link[]
}

const entriesFromAssets = async (blockchainKey: string, assets: string[]) => {
  // https://assets-cdn.trustwallet.com/blockchains/ethereum/
  // const cdnPrefix = 'https://assets-cdn.trustwallet.com/blockchains'
  // const pathPrefix = `${cdnPrefix}/${blockchainKey}/${assetsFolder}/`
  const info = path.join(blockchainsRoot, blockchainKey, 'info')
  const [networkInfo, networkLogoPath] = await load(info)
  const tokenlistPath = path.join(blockchainsRoot, blockchainKey, 'tokenlist.json')
  const list = await fs.promises.readFile(tokenlistPath).catch((_err) => {
    // console.log(err)
    return null
  })
  if (!list) return
  const tokenList = JSON.parse(list.toString()) as types.TokenList
  let chainId = networkInfo.coin_type || tokenList.tokens?.[0]?.chainId
  if (!chainId && networkInfo.rpc_url) {
    // check the chain itself
    const client = viem.createPublicClient({
      transport: viem.http(networkInfo.rpc_url),
    })
    chainId = await client.getChainId()
  }
  if (!chainId) {
    return
  }
  const key = `${providerKey}-${blockchainKey}`
  await utils.spinner(key, async () => {
    const network = await db.insertNetworkFromChainId(chainId)
    const provider = await db.insertProvider({
      key: providerKey,
      name: 'Trust Wallet',
    })
    const list = await db.insertList({
      providerId: provider.providerId,
      networkId: network.networkId,
      name: key,
      key,
    })
    await db.fetchImageAndStoreForList({
      listId: list.listId,
      uri: networkLogoPath,
      originalUri: info,
      providerKey,
    })
    await utils.limit.map(assets, async (asset) => {
      const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
      const assets = await load(folder).catch(() => null)
      if (!assets) {
        return
      }
      const [info, logoPath] = assets
      const address = asset as viem.Hex
      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: logoPath,
        originalUri: folder,
        providerKey,
        token: {
          providedId: address,
          networkId: network.networkId,
          name: info.name,
          symbol: info.symbol,
          decimals: info.decimals,
        },
      })
    })
  })
}
