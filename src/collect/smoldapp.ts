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
  const chainsPath = path.join(root, 'chains')
  const tokensPath = path.join(root, 'tokens')
  const providerKey = 'smoldapp'
  const infoBuff = await fs.promises.readFile(path.join(tokensPath, 'list.json'))
  const info = JSON.parse(infoBuff.toString()) as Info
  const { tokens } = info
  const provider = await db.insertProvider({
    key: providerKey,
    name: 'Smol Dapp',
    description: 'a communitly led initiative to collect all the evm assets',
  })
  await utils.limit.map(Object.entries(tokens).reverse(), async ([chainIdString, tokens]: [string, string[]]) => {
    const networksList = await db.insertList({
      key: 'tokens',
      providerId: provider.providerId,
    })
    await utils.spinner(`${providerKey}/${chainIdString}`, async () => {
      const network = await db.insertNetworkFromChainId(+chainIdString)
      const chain = utils.findChain(+chainIdString)
      if (!chain) {
        console.log('unable to find chain %o/%o', 'smoldapp', +chainIdString)
        return
      }
      const client = viem.createPublicClient({
        chain,
        transport: viem.http(chain.rpcUrls.default.http[0]),
      })
      const networkList = await db.insertList({
        key: `${networksList.key}-${chainIdString}`,
        providerId: provider.providerId,
      })
      await utils.limit.map(tokens, async (token: viem.Hex) => {
        const tokenFolder = path.join(tokensPath, chainIdString, token)
        const address = viem.getAddress(utils.commonNativeNames.has(token.toLowerCase() as viem.Hex)
          ? zeroAddress
          : token)
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
          await Promise.all([
            db.fetchImageAndStoreForToken({
              listId: list.listId,
              ...baseInput,
            }),
            db.fetchImageAndStoreForToken({
              listId: networkList.listId,
              ...baseInput,
            }),
            db.fetchImageAndStoreForToken({
              listId: networksList.listId,
              ...baseInput,
            }),
          ])
        })
      })
    })
  })
}
