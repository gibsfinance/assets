import * as fs from 'fs'
import * as path from 'path'
import * as db from '../db'
import * as utils from '../utils'
import type { List } from 'knex/types/tables'
import * as paths from '../paths'
import { zeroAddress, getAddress, type Hex, stringToHex } from 'viem'
import promiseLimit from 'promise-limit'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { erc20Read } from '@gibs/utils/viem'
import { TokenListVersion } from '../types'

const oneListInsertAtATime = promiseLimit<List>(2)

type Info = {
  version: TokenListVersion
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
const providerKey = 'smoldapp'

/**
 * Main collection function that processes chains and tokens
 */
export const collect = async (signal: AbortSignal) => {
  const root = path.join(paths.submodules, 'smoldapp-tokenassets')
  const tokensPath = path.join(root, 'tokens')
  const chainsPath = path.join(root, 'chains')
  const row = utils.terminal.issue({
    id: providerKey,
    type: terminalRowTypes.SETUP,
  })

  const infoBuff = await fs.promises.readFile(path.join(tokensPath, 'list.json')).catch(() => null)
  if (!infoBuff) {
    row.complete()
    return
  }
  if (signal.aborted) {
    return
  }
  const info = JSON.parse(infoBuff.toString()) as Info
  const { tokens } = info

  const [provider] = await db.insertProvider({
    key: providerKey,
    name: 'Smol Dapp',
    description: 'a communitly led initiative to collect all the evm assets',
  })
  const chainIdToNetworkId = new Map<string, List>()

  // Process chains
  const chains = await utils.folderContents(chainsPath)
  if (signal.aborted) {
    return
  }
  const folderToNetworkChainId = new Map<string, number>()
  for (const cID of chains) {
    if (cID === '_info.json') continue
    const chainIdIsNumber = !!(+cID)
    const chainId = chainIdIsNumber ? cID : cID
    if (signal.aborted) {
      return
    }
    const type = chainIdIsNumber ? 'evm' : 'btc'
    if (path.extname(chainId) === '.json') {
      row.increment(terminalCounterTypes.NETWORK, `${chainId}`)
      row.increment('skipped', `${providerKey}-${chainId}`)
      continue // handles the _info.json file (not a chain)
    }

    const networkChainId = chainIdIsNumber ? +chainId : Number(stringToHex(chainId))
    folderToNetworkChainId.set(cID, networkChainId)
    const network = await db.insertNetworkFromChainId(networkChainId, type)
    const chainFolder = path.join(chainsPath, chainId || cID)
    const folders = await utils.folderContents(chainFolder)

    for (const file of folders) {
      if (signal.aborted) {
        return
      }
      const listKey = filenameToListKey(file)
      const [networkList] = await db.insertList({
        key: `tokens-${networkChainId}-${listKey}`,
        providerId: provider.providerId,
        networkId: utils.chainIdToNetworkId(networkChainId, type),
      })

      const originalUri = path.join(chainFolder, file)
      chainIdToNetworkId.set(networkList.key, networkList)

      if (listKey === 'svg') {
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
        const img = await db.fetchImage(originalUri, signal, providerKey, chainId)
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
  if (signal.aborted) {
    return
  }
  // Process tokens
  const reverseOrderTokens = Object.entries(tokens).map(([chainIdString, tokens], i) => [chainIdString, tokens, i] as [string, string[], number])
  row.createCounter(terminalCounterTypes.TOKEN)
  row.createCounter(terminalCounterTypes.NETWORK)
  row.incrementTotal(
    terminalCounterTypes.NETWORK,
    utils.mapToSet.network(reverseOrderTokens, ([chainIdString]) => chainIdString),
  )
  const networkLimiter = promiseLimit<[string, string[], number]>(1)
  const tokenLimit = promiseLimit<[Hex, number]>(4)
  const section = row.issue(providerKey)
  let globalOrderId = 0
  for (const [chainIdString, tokens, i] of reverseOrderTokens) {
    if (signal.aborted) {
      return
    }
    const chain = utils.findChain(+chainIdString)
    if (!chain) {
      row.increment('skipped', `${providerKey}-${chainIdString}`)
      continue
    }

    row.incrementTotal(
      terminalCounterTypes.TOKEN,
      utils.mapToSet.token(tokens, (t) => [chain!.id, t]),
    )
  }
  await networkLimiter.map(reverseOrderTokens, async ([chainIdString, tokens, i]) => {
    if (signal.aborted) {
      return
    }

    const chainIdIsNumber = !!(+chainIdString)
    const type = chainIdIsNumber ? 'evm' : 'btc'
    const networkChainId = folderToNetworkChainId.get(chainIdString) ?? (+chainIdString || Number(stringToHex(chainIdString)))
    // const networkId = utils.chainIdToNetworkId(networkChainId, type)
    folderToNetworkChainId.set(chainIdString, networkChainId)
    const network = await db.insertNetworkFromChainId(networkChainId, type)
    // Pre-compute all possible network lists for this chain to avoid per-token database calls
    const networkListCache = new Map<string, List>()
    const possibleListKeys = ['svg', 'png', 'png128', 'png32'] // Based on actual smoldapp file patterns

    try {
      for (const listKey of possibleListKeys) {
        const networkKey = `tokens-${chainIdString}-${listKey}`
        if (!chainIdToNetworkId.has(networkKey)) {
          const networkList = await oneListInsertAtATime(
            async () =>
              await db
                .insertList({
                  key: networkKey,
                  providerId: provider.providerId,
                  networkId: network.networkId,
                })
                .then((list) => list?.[0] as List)
                .catch((err) => {
                  console.log('error inserting list', networkKey, networkChainId, type)
                  throw err
                })
          )!
          chainIdToNetworkId.set(networkKey, networkList)
          networkListCache.set(listKey, networkList)
        } else {
          networkListCache.set(listKey, chainIdToNetworkId.get(networkKey)!)
        }
      }
    } catch (err) {
      console.error(`Error building network list cache for chain ${chainIdString}:`, err)
      return
    }

    const tokensAndIndices = tokens.map((t, i) => [t, i] as [Hex, number])
    await tokenLimit.map(tokensAndIndices, async ([token, i]) => {
      if (signal.aborted) {
        return
      }
      const networkChainId = folderToNetworkChainId.get(chainIdString)!
      const task = section.task(`${chainIdString}-${token}`, {
        id: providerKey,
        type: terminalRowTypes.STORAGE,
        kv: {
          chainId: chainIdString,
          token,
        },
      })
      const tokenFolder = path.join(tokensPath, chainIdString, token.toLowerCase())
      const address = getAddress(utils.commonNativeNames.has(token.toLowerCase() as Hex) ? zeroAddress : token)
      let metadata: [string, string, number] | null = null
      if (chainIdIsNumber) {
        const chain = utils.findChain(+chainIdString)
        if (!chain) {
          return
        }
        metadata = await erc20Read(chain, utils.chainToPublicClient(chain), address).catch((error) => {
          console.log(error)
          return null
        })
      } else if (type === 'btc') {
        metadata = ['Bitcoin', 'BTC', 8]
      }
      if (!metadata) {
        row.increment('missing', utils.counterId.token([networkChainId, token]))
        task.complete()
        row.increment('skipped', `${providerKey}-${networkChainId}-${token}-read-error`)
        return
      }
      const [name, symbol, decimals] = metadata
      const tokenImages = await utils.folderContents(tokenFolder).catch((err) => {
        console.error(`Error getting folder contents for token ${token} on chain ${networkChainId}:`, err)
        return []
      }) as string[]

      const firstImageName = tokenImages[0]
      const listKey = filenameToListKey(firstImageName)
      const networkList = networkListCache.get(listKey)
      if (!networkList) {
        console.error(`Network list not found for listKey: ${listKey} on chain ${chainIdString}`)
        task.complete()
        row.increment('skipped', `${providerKey}-${chainIdString}-${token}-no-network-list`)
        return
      }
      for (const imageName of tokenImages) {
        const uri = path.join(tokenFolder, imageName)
        const baseInput = {
          uri,
          originalUri: uri,
          providerKey: provider.key,
          listTokenOrderId: i,
          token: {
            providedId: address,
            networkId: networkList.networkId!,
            name,
            symbol,
            decimals,
          },
        }
        if (signal.aborted) {
          return
        }
        // Batch database operations to reduce transaction overhead
        try {
          const [list] = await db.insertList({
            providerId: provider.providerId,
            key: `tokens-${listKey}`,
            default: listKey === 'svg',
          }).catch((err) => {
            console.error(`Error inserting list for token ${token} on chain ${chainIdString}:`, err)
            return [null]
          })
          if (!list) {
            console.error(`List not found for token ${token} on chain ${chainIdString}`)
            task.complete()
            row.increment('skipped', `${providerKey}-${chainIdString}-${token}-no-list`)
            return
          }

          await db.transaction(async (tx) => {
            await db.fetchImageAndStoreForToken(
              {
                listId: list.listId,
                ...baseInput,
                listTokenOrderId: globalOrderId++,
                signal,
              },
              tx,
            )
            await db.fetchImageAndStoreForToken(
              {
                listId: networkList.listId,
                ...baseInput,
                signal,
              },
              tx,
            )
          })
        } catch (dbError) {
          console.error(`Database error for token ${token} on chain ${chainIdString}:`, dbError)
          task.complete()
          row.increment('skipped', `${providerKey}-${chainIdString}-${token}-db-error`)
          return
        }
      }
      task.complete()
      row.increment(terminalCounterTypes.TOKEN, utils.counterId.token([+chainIdString, token]))
    })
    row.increment(terminalCounterTypes.NETWORK, `${chainIdString}`)
  })
  row.hideSection(providerKey)
  row.complete()
}
