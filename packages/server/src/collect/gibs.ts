// import * as inmemoryTokenList from './inmemory-tokenlist'
import * as db from '../db'
import * as fs from 'fs'
import * as path from 'path'
import * as paths from '../paths'

const pathToNativeV4Pulse = path.join(paths.harvested, 'gibs', 'images', '0x3af.png')

const providerKey = 'gibs'
const listKey = 'gibs'

const file = await fs.promises.readFile(pathToNativeV4Pulse)

export const collect = async (signal: AbortSignal) => {
  const [provider] = await db.insertProvider({
    key: providerKey,
  })
  const network = await db.insertNetworkFromChainId(943)
  const [list] = await db.insertList({
    providerId: provider.providerId,
    name: 'Gibs',
    key: listKey,
    default: true,
    major: 1,
    minor: 0,
    patch: 0,
    imageHash: null,
  })
  await db.fetchImageAndStoreForToken({
    listId: list.listId,
    listTokenOrderId: 0,
    uri: file,
    originalUri: pathToNativeV4Pulse,
    providerKey,
    token: {
      name: 'V4 Pulse',
      symbol: 'V4PLS',
      decimals: 18,
      networkId: network.networkId,
      providedId: '0x70499adEBB11Efd915E3b69E700c331778628707',
    },
  })
  // console.log('collecting gibs')
  // await inmemoryTokenList.collect({
  //   signal,
  //   providerKey: 'gibs',
  //   listKey: 'gibs',
  //   isDefault: true,
  //   tokenList: {
  //     name: 'Gibs',
  //     timestamp: (new Date()).toISOString(),
  //     version: {
  //       major: 1,
  //       minor: 0,
  //       patch: 0,
  //     },
  //     tokens: [
  //       {
  //         name: 'V4 Pulse',
  //         symbol: 'V4PLS',
  //         decimals: 18,
  //         chainId: 943,
  //         address: '0x70499adEBB11Efd915E3b69E700c331778628707',
  //         // logoURI: await fs.promises.readFile(pathToNativeV4Pulse),
  //         // logoURI: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png',
  //       }
  //     ],
  //   },
  //   // tokenList: 'https://gibs.io/tokenlist.json',
  // })
}
