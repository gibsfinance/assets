import * as fs from 'fs'
import * as path from 'path'
import * as db from '@/db'
import * as utils from '@/utils'
import type { List } from 'knex/types/tables'
import * as paths from '@/paths'
import { zeroAddress, getAddress, type Hex } from 'viem'
import promiseLimit from 'promise-limit'

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

/**
 * Main collection function that processes chains and tokens
 */
export const collect = async () => {
  // updateStatus({
  //   provider: 'smoldapp',
  //   message: '🔍 Reading token list...',
  //   phase: 'setup',
  // })

  const root = path.join(paths.submodules, 'smoldapp-tokenassets')
  const tokensPath = path.join(root, 'tokens')
  const chainsPath = path.join(root, 'chains')
  const providerKey = 'smoldapp'

  const infoBuff = await fs.promises.readFile(path.join(tokensPath, 'list.json')).catch(() => null)
  if (!infoBuff) {
    // updateStatus({
    //   provider: 'smoldapp',
    //   message: 'Failed to read token list file',
    //   phase: 'complete',
    // } satisfies StatusProps)
    return
  }

  const info = JSON.parse(infoBuff.toString()) as Info
  const { tokens } = info

  // updateStatus({
  //   provider: 'smoldapp',
  //   message: 'Setting up provider...',
  //   phase: 'setup',
  // } satisfies StatusProps)

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

  // Process chains
  const chains = await utils.folderContents(chainsPath)
  let processedChains = 0

  for (const chainId of chains) {
    if (path.extname(chainId) === '.json') {
      continue // handles the _info.json file (not a chain)
    }

    processedChains++
    // updateStatus({
    //   provider: 'smoldapp',
    //   message: `Processing chain ${chainId}`,
    //   current: processedChains,
    //   total: chains.length,
    //   phase: 'processing',
    // } satisfies StatusProps)

    const network = await db.insertNetworkFromChainId(+chainId)
    const chainFolder = path.join(chainsPath, chainId)
    const folders = await utils.folderContents(chainFolder)

    for (const file of folders) {
      const listKey = filenameToListKey(file)
      // updateStatus({
      //   provider: 'smoldapp',
      //   message: `Processing chain ${chainId} list: ${listKey}`,
      //   current: processedChains,
      //   total: chains.length,
      //   phase: 'processing',
      // } satisfies StatusProps)

      const [networkList] = await db.insertList({
        key: `tokens-${chainId}-${listKey}`,
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(+chainId),
      })

      const originalUri = path.join(chainFolder, file)
      chainIdToNetworkId.set(networkList.key, networkList)

      if (listKey === 'svg') {
        // updateStatus({
        //   provider: 'smoldapp',
        //   message: `Storing SVG assets for chain ${chainId}`,
        //   current: processedChains,
        //   total: chains.length,
        //   phase: 'storing',
        // } satisfies StatusProps)

        await db.transaction(async (tx) => {
          await db.fetchImageAndStoreForNetwork(
            {
              network,
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
        // updateStatus({
        //   provider: 'smoldapp',
        //   message: `Storing PNG assets for chain ${chainId}...`,
        //   phase: 'storing',
        // })
        const img = await db.fetchImage(originalUri, providerKey, chainId)
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

  // Process tokens
  const reverseOrderTokens = Object.entries(tokens).reverse()
  let processedChainTokens = 0

  for (const [chainIdString, tokens] of reverseOrderTokens) {
    processedChainTokens++
    // updateStatus({
    //   provider: 'smoldapp',
    //   message: `Processing chain ${chainIdString} tokens`,
    //   current: processedChainTokens,
    //   total: reverseOrderTokens.length,
    //   phase: 'processing',
    // } satisfies StatusProps)

    const chain = utils.findChain(+chainIdString)
    if (!chain) {
      // updateStatus({
      //   provider: 'smoldapp',
      //   message: `Failed to find chain ${chainIdString}`,
      //   current: processedChainTokens,
      //   total: reverseOrderTokens.length,
      //   phase: 'processing',
      // } satisfies StatusProps)
      continue
    }

    const network = await db.insertNetworkFromChainId(+chainIdString)
    if (!network) {
      // updateStatus({
      //   provider: 'smoldapp',
      //   message: `Failed to find network for chain ${chainIdString}`,
      //   current: processedChainTokens,
      //   total: reverseOrderTokens.length,
      //   phase: 'processing',
      // } satisfies StatusProps)
      continue
    }

    const client = utils.chainToPublicClient(chain)
    const limit = promiseLimit<Hex>(256)
    let processedTokens = 0
    const totalTokens = tokens.length

    try {
      await limit.map(tokens as Hex[], async (token) => {
        processedTokens++
        // updateStatus({
        //   provider: 'smoldapp',
        //   message: `Processing token ${token}`,
        //   current: processedTokens,
        //   total: totalTokens,
        //   phase: 'processing',
        // } satisfies StatusProps)

        const tokenFolder = path.join(tokensPath, chainIdString, token.toLowerCase())
        const address = getAddress(utils.commonNativeNames.has(token.toLowerCase() as Hex) ? zeroAddress : token)

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

          // updateStatus({
          //   provider: 'smoldapp',
          //   message: `Storing token ${symbol} (${name})`,
          //   current: processedTokens,
          //   total: totalTokens,
          //   phase: 'storing',
          // } satisfies StatusProps)

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
          })
        }
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      // updateStatus({
      //   provider: 'smoldapp',
      //   message: `Failed to process chain ${chainIdString}: ${errorMessage}`,
      //   current: processedChainTokens,
      //   total: reverseOrderTokens.length,
      // })
    }
  }

  // updateStatus({
  //   provider: 'smoldapp',
  //   message: 'Collection complete!',
  //   phase: 'complete',
  // })
}
