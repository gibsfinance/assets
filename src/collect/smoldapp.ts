/**
 * @title Smol Dapp Token List Collector
 * @notice Collects token information and images from Smol Dapp's community-led asset collection
 * @dev Changes from original version:
 * 1. Replaced spinner with direct console status updates
 * 2. Added detailed progress tracking for chains and tokens
 * 3. Improved error handling and logging
 * 4. Added clear phase separation with status messages
 */

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

/**
 * @notice Main collection function that processes chains and tokens
 * @dev Changes:
 * 1. Added phase-specific status messages
 * 2. Implemented chain processing progress tracking
 * 3. Added token processing progress tracking
 * 4. Removed spinner in favor of direct status updates
 * 5. Enhanced error handling with detailed messages
 */
export const collect = async () => {
  utils.updateStatus(`🔍 [smoldapp] Reading token list...`)
  const root = path.join(utils.submodules, 'smoldapp-tokenassets')
  const tokensPath = path.join(root, 'tokens')
  const chainsPath = path.join(root, 'chains')
  const providerKey = 'smoldapp'

  const infoBuff = await fs.promises.readFile(path.join(tokensPath, 'list.json')).catch(() => null)
  if (!infoBuff) return

  const info = JSON.parse(infoBuff.toString()) as Info
  const { tokens } = info

  utils.updateStatus(`🏗️ [smoldapp] Setting up provider...`)
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
  utils.updateStatus(`🔗 [smoldapp] Processing chains...`)
  const chains = await utils.folderContents(chainsPath)
  let processedChains = 0

  for (const chainId of chains) {
    if (path.extname(chainId) === '.json') {
      continue // handles the _info.json file (not a chain)
    }

    processedChains++
    utils.updateStatus(`⚡ [smoldapp] Processing chain ${processedChains}/${chains.length}: ${chainId}...`)

    await db.insertNetworkFromChainId(+chainId)
    const chainFolder = path.join(chainsPath, chainId)
    const folders = await utils.folderContents(chainFolder)

    for (const file of folders) {
      const listKey = filenameToListKey(file)
      utils.updateStatus(`📥 [smoldapp] Processing ${chainId} - ${listKey}...`)

      const [networkList] = await db.insertList({
        key: `tokens-${chainId}-${listKey}`,
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(+chainId),
      })

      const originalUri = path.join(chainFolder, file)
      chainIdToNetworkId.set(networkList.key, networkList)

      if (listKey === 'svg') {
        utils.updateStatus(`🖼️ [smoldapp] Storing SVG assets for chain ${chainId}...`)
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
        utils.updateStatus(`💾 [smoldapp] Storing PNG assets for chain ${chainId}...`)
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

  // Process tokens
  const reverseOrderTokens = Object.entries(tokens).reverse()
  let processedChainTokens = 0

  for (const [chainIdString, tokens] of reverseOrderTokens) {
    processedChainTokens++
    utils.updateStatus(
      `⛓️ [smoldapp] Processing chain tokens ${processedChainTokens}/${reverseOrderTokens.length}: Chain ${chainIdString}...`,
    )

    const chain = utils.findChain(+chainIdString)
    if (!chain) {
      utils.failureLog('unable to find chain %o/%o', 'smoldapp', +chainIdString)
      continue
    }

    const network = await db.insertNetworkFromChainId(+chainIdString)
    if (!network) {
      utils.failureLog('unable to find network %o/%o', 'smoldapp', +chainIdString)
      continue
    }

    const client = utils.publicClient(chain)
    const limit = promiseLimit<viem.Hex>(256)
    let processedTokens = 0

    await limit
      .map(tokens as viem.Hex[], async (token) => {
        processedTokens++
        utils.updateStatus(
          `📥 [smoldapp] Chain ${chainIdString}: Processing token ${processedTokens}/${tokens.length}: ${token}...`,
        )

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

          utils.updateStatus(`💾 [smoldapp] Storing token ${processedTokens}/${tokens.length}: ${symbol}...`)
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
      .catch((err) => {
        utils.failureLog('each token', err)
        return null
      })
  }

  utils.updateStatus(`✨ [smoldapp] Collection complete!`)
  process.stdout.write('\n')
}
