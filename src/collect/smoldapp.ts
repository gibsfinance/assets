import * as utils from '@/utils'
import * as viem from 'viem'
import * as path from 'path'
import * as fs from 'fs'
import * as db from '@/db'
import { zeroAddress } from 'viem';

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
  const networksList = await db.insertList({
    key: 'tokens',
    providerId: provider.providerId,
  })
  await utils.spinner(`smoldapp/chains`, async () => {
    await utils.folderContents(chainsPath, async (chainId) => {
      if (path.extname(chainId) === '.json') return
      const networkList = await db.insertList({
        key: `${networksList.key}-${chainId}`,
        providerId: provider.providerId,
      })
      const chainFolder = path.join(chainsPath, chainId)
      await utils.folderContents(chainFolder, async (file: string) => {
        const originalUri = path.join(chainFolder, file)
        if (path.extname(file) === '.svg') {
          await db.fetchImageAndStoreForList({
            listId: networkList.listId,
            providerKey,
            uri: originalUri,
            originalUri,
          })
        } else {
          await db.fetchImage(originalUri, providerKey)
        }
      })
    })
  })
  const reverseOrderTokens = Object.entries(tokens).reverse()
  for (const [chainIdString, tokens] of reverseOrderTokens) {
    let completed = 0
    let total = 0
    const k = `${providerKey}/${chainIdString}`
    await utils.spinner(k, async () => {
      const network = await db.insertNetworkFromChainId(+chainIdString)
      const chain = utils.findChain(+chainIdString)
      if (!chain) {
        console.log('unable to find chain %o/%o', 'smoldapp', +chainIdString)
        return
      }
      const client = viem.createPublicClient({
        chain,
        transport: viem.http(),
      })
      const networkList = await db.insertList({
        key: `${networksList.key}-${chainIdString}`,
        providerId: provider.providerId,
      })
      total += tokens.length
      await utils.limit.map(tokens, async (token: viem.Hex) => {
        const tokenFolder = path.join(tokensPath, chainIdString, token)
        const address = viem.getAddress(utils.commonNativeNames.has(token.toLowerCase() as viem.Hex)
          ? zeroAddress
          : token)
        // console.log('inserting list %o', networkList.key, address)
        const list = await db.insertList({
          key: `${networkList.key}-${address}`,
          providerId: provider.providerId,
        })
        const [name, symbol, decimals] = await utils.erc20Read(chain, client, address)
        await utils.folderContents(tokenFolder, async (imageName) => {
          const uri = path.join(tokensPath, chainIdString, token, imageName)
          const baseInput = {
            uri,
            originalUri: uri,
            providerKey: provider.key,
            token: {
              providedId: address,
              networkId: network.networkId,
              name,
              symbol,
              decimals,
            },
          }
          // console.log('inserting %o %o', provider.key, uri)
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
        }).catch((err) => {
          console.log(err)
          return null
        })
        completed++
      }).catch(() => {
        console.log('each token')
        return null
      })
    }).catch(() => {
      console.log('spinner')
      return null
    })
    // console.log('completed %o %o/%o', k, completed, total)
  }
}
