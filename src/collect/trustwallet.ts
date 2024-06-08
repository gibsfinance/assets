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
  const blockchainFolders = utils.removedUndesirable(fs.readdirSync(blockchainsRoot))
  await utils.limit.map(blockchainFolders, async (folder) => {
    try {
      const assets = await fs.promises.readdir(path.join(blockchainsRoot, folder, assetsFolder))
      await entriesFromAssets(folder, utils.removedUndesirable(assets))
    } catch (err) {
      return ''
    }
  })
}

const load = async (p: string) => {
  return await Promise.all([
    fs.promises.readFile(path.join(p, 'info.json')).then((info) => JSON.parse(info.toString()) as Info),
    fs.promises.readFile(path.join(p, 'logo.png')),
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
  const [networkInfo, networkLogo] = await load(info)
  const tokenList = JSON.parse(
    (await fs.promises.readFile(path.join(blockchainsRoot, blockchainKey, 'tokenlist.json'))).toString(),
  ) as types.TokenList
  let chainId = networkInfo.coin_type || tokenList.tokens[0].chainId
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
  const key = `${providerKey}/${blockchainKey}`
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
      uri: networkLogo,
      originalUri: info,
      providerKey,
    })
    await utils.limit.map(assets, async (asset) => {
      const folder = path.join(blockchainsRoot, blockchainKey, assetsFolder, asset)
      const assets = await load(folder).catch(() => null)
      if (!assets) {
        return
      }
      const [info, logo] = assets
      const address = asset as viem.Hex
      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: logo,
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
  // return {
  //   logoURI: networkInfo.logoURI || '',
  //   chainId,
  //   entries: await utils.limit.map(assets, async (asset) => {
  //     const [info, logo] = await load(path.join(blockchainsRoot, blockchainKey, assetsFolder, asset))
  //     const address = asset as viem.Hex
  //     const writeResult = await utils.tokenImage.update(chainId, address, logo)
  //     if (!writeResult) return null
  //     const entry: types.TokenEntry = {
  //       name: info.name,
  //       decimals: info.decimals,
  //       symbol: info.symbol,
  //       chainId,
  //       address,
  //       logoURI: utils.tokenImage.path(chainId, address, {
  //         outRoot: true,
  //         version: writeResult.version,
  //         ext: path.extname(writeResult.path),
  //       }),
  //     }
  //     return entry
  //   }),
  // }
}
