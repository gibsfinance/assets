import * as fs from 'fs'
import * as path from 'path'
import * as db from '../db'
import * as utils from '../utils'
import type { List } from 'knex/types/tables'
import * as paths from '../paths'
import { zeroAddress, getAddress, type Hex } from 'viem'
import promiseLimit from 'promise-limit'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { erc20Read } from '@gibs/utils/viem'

const oneListInsertAtATime = promiseLimit<List>(2)

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
  for (const chainId of chains) {
    if (signal.aborted) {
      return
    }
    if (path.extname(chainId) === '.json') {
      row.increment(terminalCounterTypes.NETWORK, `${chainId}`)
      row.increment('skipped', `${providerKey}-${chainId}`)
      continue // handles the _info.json file (not a chain)
    }

    const network = await db.insertNetworkFromChainId(+chainId)
    const chainFolder = path.join(chainsPath, chainId)
    const folders = await utils.folderContents(chainFolder)

    for (const file of folders) {
      const listKey = filenameToListKey(file)
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
    utils.mapToSet.network(reverseOrderTokens, ([chainIdString]) => +chainIdString),
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
    const network = chain && (await db.insertNetworkFromChainId(+chainIdString))
    if (!network) {
      row.increment('skipped', `${providerKey}-${chainIdString}`)
      row.increment(
        terminalCounterTypes.TOKEN,
        utils.mapToSet.token(tokens, (t) => [chain!.id, t]),
      )
      row.increment(terminalCounterTypes.NETWORK, `${chainIdString}`)
      continue
    }

    row.incrementTotal(
      terminalCounterTypes.TOKEN,
      utils.mapToSet.token(tokens, (t) => [chain!.id, t]),
    )
  }
  await networkLimiter.map(reverseOrderTokens, async ([chainIdString, tokens, i]) => {
    if (signal.aborted) {
      console.log('signal aborted', chainIdString)
      return
    }
    const chain = utils.findChain(+chainIdString)
    if (!chain) {
      return
    }
    const network = await db.insertNetworkFromChainId(+chainIdString)
    if (!network) {
      return
    }

    // Pre-compute all possible network lists for this chain to avoid per-token database calls
    const networkListCache = new Map<string, List>()
    const possibleListKeys = ['svg', 'png', 'png128', 'png32'] // Based on actual smoldapp file patterns

    try {
      for (const listKey of possibleListKeys) {
        const networkKey = `tokens-${chain.id}-${listKey}`
        if (!chainIdToNetworkId.has(networkKey)) {
          const networkList = await oneListInsertAtATime(
            async () =>
              await db
                .insertList({
                  key: networkKey,
                  providerId: provider.providerId,
                  networkId: utils.chainIdToNetworkId(chain.id),
                })
                .then((list) => list?.[0] as List),
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
    const client = utils.chainToPublicClient(chain)
    await tokenLimit.map(tokensAndIndices, async ([token, i]) => {
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

      const metadata = await erc20Read(chain, client, address).catch((error) => {
        console.log(error)
        return null
      })
      if (!metadata) {
        row.increment('missing', utils.counterId.token([+chainIdString, token]))
        task.complete()
        row.increment('skipped', `${providerKey}-${chainIdString}-${token}-read-error`)
        return
      }
      const [name, symbol, decimals] = metadata
      const tokenImages = await utils.folderContents(tokenFolder).catch((err) => {
        console.error(`Error getting folder contents for token ${token} on chain ${chainIdString}:`, err)
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
