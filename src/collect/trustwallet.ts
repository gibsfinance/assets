import * as fs from 'fs'
import * as path from 'path'
import * as utils from '../utils'
import * as types from '../types'
import * as viem from 'viem'
import _ from 'lodash'

const blockchainsRoot = path.join(utils.root, 'submodules', 'trustwallet', 'blockchains')
const assetsFolder = 'assets'

export const collect = async (): Promise<string[]> => {
  const blockchainFolders = utils.removedUndesirable(fs.readdirSync(blockchainsRoot))
  return await utils.limit.map(blockchainFolders, async (folder) => {
    try {
      const assets = await fs.promises.readdir(path.join(blockchainsRoot, folder, assetsFolder))
      const entries = await entriesFromAssets(folder, utils.removedUndesirable(assets))
      const result = await utils.providerLink.update('trustwallet', _.compact(entries))
      return result.path
    } catch (err) {
      return ''
    }
  })
}

const load = async (p: string) => {
  return await Promise.all([
    fs.promises.readFile(path.join(p, 'info.json'))
      .then((info) => JSON.parse(info.toString()) as Info),
    fs.promises.readFile(path.join(p, 'logo.png')),
  ])
}

type Link = {
  name: string;
  url: string;
}

type Info = types.TokenEntry & {
  website?: string;
  description?: string;
  explorer?: string;
  research?: string;
  coin_type?: number;
  status?: string;
  rpc_url?: string;
  tags?: string[];
  links: Link[];
}

const entriesFromAssets = async (blockchainKey: string, assets: string[]) => {
  // https://assets-cdn.trustwallet.com/blockchains/ethereum/
  const cdnPrefix = 'https://assets-cdn.trustwallet.com/blockchains'
  // const pathPrefix = `${cdnPrefix}/${blockchainKey}/${assetsFolder}/`
  const [networkInfo, networkLogo] = await load(path.join(blockchainsRoot, blockchainKey, 'info'))
  const tokenList = JSON.parse((await fs.promises.readFile(path.join(blockchainsRoot, blockchainKey, 'tokenlist.json'))).toString()) as types.TokenList
  let chainId = networkInfo.coin_type || tokenList.tokens[0].chainId
  if (!chainId && networkInfo.rpc_url) {
    // check the chain itself
    const client = viem.createPublicClient({
      transport: viem.http(networkInfo.rpc_url),
    })
    chainId = await client.getChainId()
  }
  return await utils.limit.map(assets, async (asset) => {
    const [info, logo] = await load(path.join(blockchainsRoot, blockchainKey, assetsFolder, asset))
    const address = asset as viem.Hex
    const writeResult = await utils.tokenImage.update(chainId, address, logo)
    if (!writeResult) return null
    const entry: types.TokenEntry = {
      name: info.name,
      decimals: info.decimals,
      symbol: info.symbol,
      chainId,
      address,
      logoURI: utils.tokenImage.path(chainId, address, {
        outRoot: true,
        version: writeResult.version,
        ext: path.extname(writeResult.path),
      }),
    }
    return entry
  })
}
