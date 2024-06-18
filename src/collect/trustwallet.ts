import * as fs from 'fs'
import * as db from '@/db'
import * as path from 'path'
import * as utils from '@/utils'
import * as types from '@/types'
import * as viem from 'viem'
import _ from 'lodash'
import { Image } from 'knex/types/tables'

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
      utils.failureLog(err)
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
  const provider = await db.insertProvider({
    key: providerKey,
    name: 'Trust Wallet',
  })
  const trustwalletList = await db.insertList({
    key: 'wallet',
    default: true,
    providerId: provider.providerId,
  })
  const key = `wallet-${blockchainKey}`
  await utils.spinner(key, async () => {
    const network = await db.insertNetworkFromChainId(chainId)
    const networkList = await db.insertList({
      providerId: provider.providerId,
      networkId: network.networkId,
      name: key,
      key,
    })
    const res = await db.fetchImageAndStoreForList({
      listId: networkList.listId,
      uri: networkLogoPath,
      originalUri: networkLogoPath,
      providerKey,
    })
    if (res) {
      const resWImage = res as { image: Image }
      await db.fetchImageAndStoreForList({
        listId: trustwalletList.listId,
        uri: resWImage.image ? resWImage.image.content : null,
        originalUri: networkLogoPath,
        providerKey,
      })
    }
    for (const asset of assets) {
      const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
      const assets = await load(folder).catch(() => null)
      if (!assets) {
        return
      }
      const [info, logoPath] = assets
      const address = asset as viem.Hex
      for (const list of [networkList, trustwalletList]) {
        const file = await db.fetchImage(logoPath, networkList.key)
        if (!file) continue
        await db.fetchImageAndStoreForToken({
          listId: list.listId,
          uri: file,
          originalUri: logoPath,
          providerKey,
          token: {
            providedId: address,
            networkId: network.networkId,
            name: info.name,
            symbol: info.symbol,
            decimals: info.decimals,
          },
        })
      }
    }
  })
}
