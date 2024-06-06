import * as types from '../types'
import * as path from 'path'
import * as utils from '../utils'
import { zeroAddress } from 'viem'
import { fetch } from '../fetch'
import _ from 'lodash'
import { setTimeout } from 'timers/promises'

export const collect = async (
  providerKey: string,
  tokenList: Omit<types.TokenList, 'tokenMap'>,
) => {
  return utils.spinner(providerKey, async () => {
    const listImage = await fetch(tokenList.logoURI).then(utils.responseToBuffer)
      .catch((err) => {
        console.log('%o -> %o', providerKey, tokenList.logoURI)
        console.log(err)
        return
      })
    let listLogoURI = ''
    if (listImage) {
      const writeResult = await utils.providerImage.update(providerKey, listImage)
      if (writeResult) {
        listLogoURI = writeResult.path
      }
    }
    const entries = await utils.limit.map(tokenList.tokens, async (entry: types.TokenEntry) => {
      if (!entry.logoURI) {
        return entry
      }
      const image = await Promise.race([
        setTimeout(10_000),
        fetch(entry.logoURI).then(utils.responseToBuffer)
          .catch(async () => {
            await setTimeout(3_000)
            return await fetch(entry.logoURI).then(utils.responseToBuffer)
          })
          .catch((err: Error) => {
            console.log('%o -> %o', providerKey, entry.logoURI)
            if (err.toString().includes('This operation was abort')) {
              return
            }
            console.log(providerKey, entry)
            console.log(err)
            return null
          }),
      ])
      if (!image) {
        return
      }
      const ext = path.extname(entry.logoURI)
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
      return {
        ...entry,
        logoURI: filePath,
      }
    })
    const {
      path: providerTokenlistPath,
    } = await utils.providerLink.update(providerKey, _.compact(entries), {
      logoURI: listLogoURI || '',
    })
    return providerTokenlistPath
  })
}
