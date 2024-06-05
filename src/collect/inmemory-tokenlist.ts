import * as types from '../types'
import * as path from 'path'
import * as utils from '../utils'
import { zeroAddress } from 'viem'

export const collect = async (providerKey: string, tokenList: Omit<types.TokenList, 'tokenMap'>) => {
  const listImage = await fetch(tokenList.logoURI).then(utils.responseToBuffer)
  const { path: listLogoURI } = await utils.providerImage.update(providerKey, listImage)
  const entries: types.TokenEntry[] = []
  await utils.limit.map(tokenList.tokens, async (entry: types.TokenEntry) => {
    const image = await fetch(entry.logoURI).then(utils.responseToBuffer)
    const ext = path.extname(entry.logoURI).slice(1)
    const version = utils.calculateHash(image)
    let address = entry.address
    if (utils.commonNativeNames.has(address)) {
      address = zeroAddress
    }
    const filePath = utils.tokenImage.path(entry.chainId, address, {
      ext,
      version,
      outRoot: true,
    })
    await utils.tokenImage.update(entry.chainId, address, image, {
      version,
      ext,
      setLatest: false,
    })
    entries.push({
      ...entry,
      logoURI: filePath,
    })
  })
  const { path: providerTokenlistPath } = await utils.providerLink.update(providerKey, entries, {
    logoURI: listLogoURI,
  })
  return providerTokenlistPath
}
