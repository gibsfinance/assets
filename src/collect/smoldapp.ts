import * as utils from '@/utils'
import * as viem from 'viem'
import * as path from 'path'
import * as fs from 'fs'
import * as db from '@/db'
import { zeroAddress } from 'viem'
import promiseLimit from 'promise-limit'
import type { List } from 'knex/types/tables'

type Version = {
  major: number
  minor: number
  patch: number
}

type Info = {
  version: Version
  tokens: Record<string, string[]>
}

const filenameToListKey = (filename: string) => {
  const extname = path.extname(filename)
  if (extname === '.svg') {
    return 'svg'
  }
  const noExt = filename.split(extname).join('')
  const noPrefix = noExt.split('logo-').join('')
  return `png${noPrefix}`
}

export const collect = async () => {
  const root = path.join(utils.submodules, 'smoldapp-tokenassets')
  const tokensPath = path.join(root, 'tokens')
  const chainsPath = path.join(root, 'chains')
  const providerKey = 'smoldapp'
  const infoBuff = await fs.promises.readFile(path.join(tokensPath, 'list.json')).catch(() => null)
  if (!infoBuff) return
  const info = JSON.parse(infoBuff.toString()) as Info
  const { tokens } = info
  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'Smol Dapp',
    description: 'a communitly led initiative to collect all the evm assets',
  })
  // const baseNetwork = await db.insertNetworkFromChainId(0)
  // const networksList = await db.insertList({
  //   key: 'tokens',
  //   // default: true,
  //   providerId: provider.providerId,
  //   networkId: baseNetwork.networkId,
  // })
  const chainIdToNetworkId = new Map<string, List>()
  await utils.spinner(`smoldapp/chains`, async () => {
    const chains = await utils.folderContents(chainsPath)
    for (const chainId of chains) {
      if (path.extname(chainId) === '.json') {
        // handles the _info.json file (not a chain)
        continue
      }
      await db.insertNetworkFromChainId(+chainId)
      const chainFolder = path.join(chainsPath, chainId)
      const folders = await utils.folderContents(chainFolder)
      for (const file of folders) {
        const listKey = filenameToListKey(file)
        console.log(`tokens-${chainId}-${listKey}`)
        const [networkList] = await db.insertList({
          key: `tokens-${chainId}-${listKey}`,
          providerId: provider.providerId,
          networkId: utils.chainIdToNetworkId(+chainId),
        })
        const originalUri = path.join(chainFolder, file)
        chainIdToNetworkId.set(networkList.key, networkList)
        if (listKey === 'svg') {
          await db.transaction(async (tx) => {
            await db.fetchImageAndStoreForNetwork(
              {
                chainId: +chainId,
                uri: originalUri,
                originalUri,
                providerKey,
              },
              tx,
            )
            await db.fetchImageAndStoreForList(
              {
                listId: networkList.listId,
                providerKey,
                uri: originalUri,
                originalUri,
              },
              tx,
            )
          })
        } else {
          const img = await db.fetchImage(originalUri, providerKey)
          await db.transaction(async (tx) => {
            await db.fetchImageAndStoreForList(
              {
                listId: networkList.listId,
                providerKey,
                uri: img,
                originalUri,
              },
              tx,
            )
            if (!img) return
            await db.insertImage(
              {
                providerKey,
                image: img,
                originalUri,
                listId: networkList.listId,
              },
              tx,
            )
          })
        }
      }
    }
  })
  const reverseOrderTokens = Object.entries(tokens).reverse()
  for (const [chainIdString, tokens] of reverseOrderTokens) {
    // let completed = 0
    // let total = 0
    const k = `${providerKey}/${chainIdString}`
    await utils
      .spinner(k, async (l) => {
        const chain = utils.findChain(+chainIdString)
        if (!chain) {
          // viem does not have this chain, can't collect
          utils.failureLog('unable to find chain %o/%o', 'smoldapp', +chainIdString)
          return
        }
        const network = await db.insertNetworkFromChainId(+chainIdString)
        if (!network) {
          utils.failureLog('unable to find network %o/%o', 'smoldapp', +chainIdString)
        }
        l.incrementMax(tokens.length)
        const client = utils.publicClient(chain)
        // total += tokens.length
        const limit = promiseLimit<viem.Hex>(256)
        await limit
          .map(tokens as viem.Hex[], async (token) => {
            const tokenFolder = path.join(tokensPath, chainIdString, token.toLowerCase())
            const address = viem.getAddress(
              utils.commonNativeNames.has(token.toLowerCase() as viem.Hex) ? zeroAddress : token,
            )
            const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)
            const tokenImages = await utils.folderContents(tokenFolder)
            for (const imageName of tokenImages) {
              const listKey = filenameToListKey(imageName)
              const networkKey = `tokens-${chain.id}-${listKey}`
              const networkList =
                chainIdToNetworkId.get(networkKey) ||
                (await db
                  .insertList({
                    key: networkKey,
                    providerId: provider.providerId,
                    networkId: utils.chainIdToNetworkId(chain.id),
                  })
                  .then((list) => list?.[0] as List))!
              const uri = path.join(tokenFolder, imageName)
              const baseInput = {
                uri,
                originalUri: uri,
                providerKey: provider.key,
                token: {
                  providedId: address,
                  networkId: networkList.networkId!,
                  name,
                  symbol,
                  decimals,
                },
              }
              await db.transaction(async (tx) => {
                const [list] = await db.insertList(
                  {
                    providerId: provider.providerId,
                    key: `tokens-${listKey}`,
                    default: listKey === 'svg',
                  },
                  tx,
                )
                await db.fetchImageAndStoreForToken(
                  {
                    listId: list.listId,
                    ...baseInput,
                  },
                  tx,
                )
                await db.fetchImageAndStoreForToken(
                  {
                    listId: networkList.listId,
                    ...baseInput,
                  },
                  tx,
                )
                // await db.fetchImageAndStoreForToken({
                //   listId: networksList.listId,
                //   ...baseInput,
                // }, tx)
              })
            }
            // completed++
          })
          .catch((err) => {
            utils.failureLog('each token', err)
            return null
          })
        l.incrementCurrent()
      })
      .catch((err) => {
        utils.failureLog('spinner', err)
        return null
      })
    // console.log('completed %o %o/%o', k, completed, total)
  }
}
