import * as utils from '@/utils'
import * as viem from 'viem'
import * as path from 'path'
import * as fs from 'fs'
import * as db from '@/db'
import { zeroAddress } from 'viem';
import promiseLimit from 'promise-limit'
import { List, Network } from 'knex/types/tables'

type Version = {
  major: number;
  minor: number;
  patch: number;
}

type Info = {
  version: Version;
  tokens: Record<string, string[]>;
}

export const collect = async () => {
  const root = path.join(utils.submodules, 'smoldapp-tokenassets')
  const tokensPath = path.join(root, 'tokens')
  const chainsPath = path.join(root, 'chains')
  const providerKey = 'smoldapp'
  const infoBuff = await fs.promises.readFile(path.join(tokensPath, 'list.json'))
    .catch(() => null)
  if (!infoBuff) return
  const info = JSON.parse(infoBuff.toString()) as Info
  const { tokens } = info
  const provider = await db.insertProvider({
    key: providerKey,
    name: 'Smol Dapp',
    description: 'a communitly led initiative to collect all the evm assets',
  })
  const baseNetwork = await db.insertNetworkFromChainId(0)
  const networksList = await db.insertList({
    key: 'tokens',
    default: true,
    providerId: provider.providerId,
    networkId: baseNetwork.networkId,
  })
  const chainIdToNetworkId = new Map<number, List>()
  await utils.spinner(`smoldapp/chains`, async () => {
    const chains = await utils.folderContents(chainsPath)
    for (const chainId of chains) {
      if (path.extname(chainId) === '.json') return
      await db.insertNetworkFromChainId(+chainId)
      const networkList = await db.insertList({
        key: `${networksList.key}-${chainId}`,
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(+chainId),
      })
      chainIdToNetworkId.set(+chainId, networkList)
      const chainFolder = path.join(chainsPath, chainId)
      const folders = await utils.folderContents(chainFolder)
      for (const file of folders) {
        await Promise.all([networksList, networkList].map(async (list) => {
          const originalUri = path.join(chainFolder, file)
          if (path.extname(file) === '.svg') {
            await db.transaction(async (tx) => {
              await db.fetchImageAndStoreForNetwork({
                chainId: +chainId,
                uri: originalUri,
                originalUri,
                providerKey,
              }, tx)
              await db.fetchImageAndStoreForList({
                listId: list.listId,
                providerKey,
                uri: originalUri,
                originalUri,
              }, tx)
            })
          } else {
            const img = await db.fetchImage(originalUri, providerKey)
            if (!img) return
            await db.transaction(async (tx) => {
              await db.insertImage({
                providerKey,
                image: img,
                originalUri,
                listId: list.listId,
              }, tx)
            })
          }
        }))
      }
    }
  })
  const reverseOrderTokens = Object.entries(tokens).reverse()
  for (const [chainIdString, tokens] of reverseOrderTokens) {
    let completed = 0
    let total = 0
    const k = `${providerKey}/${chainIdString}`
    await utils.spinner(k, async () => {
      const chain = utils.findChain(+chainIdString)
      if (!chain) {
        utils.failureLog('unable to find chain %o/%o', 'smoldapp', +chainIdString)
        return
      }
      const client = viem.createPublicClient({
        chain,
        transport: viem.http(),
      })
      const networkList = chainIdToNetworkId.get(chain.id) || await db.insertList({
        key: `${networksList.key}-${chain.id}`,
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(chain.id),
      })
      total += tokens.length
      const limit = promiseLimit<viem.Hex>(4)
      await limit.map(tokens as viem.Hex[], async (token) => {
        const tokenFolder = path.join(tokensPath, chainIdString, token.toLowerCase())
        const address = viem.getAddress(utils.commonNativeNames.has(token.toLowerCase() as viem.Hex)
          ? zeroAddress
          : token)
        const list = await db.insertList({
          key: `${networkList.key}-${address}`,
          providerId: provider.providerId,
        })
        const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)
        const tokenImages = await utils.folderContents(tokenFolder)
        for (const imageName of tokenImages) {
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
            await db.fetchImageAndStoreForToken({
              listId: list.listId,
              ...baseInput,
            }, tx)
          })
          await db.transaction(async (tx) => {
            await db.fetchImageAndStoreForToken({
              listId: networkList.listId,
              ...baseInput,
            }, tx)
          })
          await db.transaction(async (tx) => {
            await db.fetchImageAndStoreForToken({
              listId: networksList.listId,
              ...baseInput,
            }, tx)
          })
        }
        completed++
      }).catch((err) => {
        utils.failureLog('each token', err)
        return null
      })
    }).catch((err) => {
      utils.failureLog('spinner', err)
      return null
    })
    // console.log('completed %o %o/%o', k, completed, total)
  }
}
