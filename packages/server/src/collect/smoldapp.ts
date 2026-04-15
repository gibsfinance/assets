import * as fs from 'fs'
import * as path from 'path'
import * as db from '../db'
import * as utils from '../utils'
import type { List } from '../db/schema-types'
import * as paths from '../paths'
import { zeroAddress, getAddress, type Hex, stringToHex } from 'viem'
import promiseLimit from 'promise-limit'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { erc20Read } from '@gibs/utils/viem'
import { failureLog } from '@gibs/utils'
import { TokenListVersion } from '../types'
import { BaseCollector, DiscoveryManifest } from './base-collector'

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
 * Two-phase collector for Smol Dapp token assets.
 * Phase 1 (discover): scans submodule to enumerate chains and formats, creates provider + lists.
 * Phase 2 (collect): processes token images from filesystem.
 */
class SmoldappCollector extends BaseCollector {
  readonly key = 'smoldapp'

  private root = path.join(paths.submodules, 'smoldapp-tokenassets')
  private tokensPath = path.join(this.root, 'tokens')
  private chainsPath = path.join(this.root, 'chains')
  private info: Info | null = null
  private chainIdToNetworkId = new Map<string, List>()
  private folderToNetworkChainId = new Map<string, number>()

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const infoBuff = await fs.promises.readFile(path.join(this.tokensPath, 'list.json')).catch(() => null)
    if (!infoBuff) return []
    if (signal.aborted) return []

    this.info = JSON.parse(infoBuff.toString()) as Info

    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'Smol Dapp',
      description: 'a communitly led initiative to collect all the evm assets',
    })

    const lists: { listKey: string; listId?: string }[] = []

    // Process chains to discover lists
    const chains = await utils.folderContents(this.chainsPath)
    if (signal.aborted) return []

    for (const cID of chains) {
      if (cID === '_info.json') continue
      const chainIdIsNumber = !!+cID
      const chainId = chainIdIsNumber ? cID : cID
      if (signal.aborted) return []

      if (path.extname(chainId) === '.json') {
        continue
      }

      const networkChainId = chainIdIsNumber ? +chainId : Number(stringToHex(chainId))
      this.folderToNetworkChainId.set(cID, networkChainId)
      const type = chainIdIsNumber ? 'evm' : 'btc'
      await db.insertNetworkFromChainId(networkChainId, type)
      const chainFolder = path.join(this.chainsPath, chainId || cID)
      const folders = await utils.folderContents(chainFolder)

      for (const file of folders) {
        if (signal.aborted) return []
        const listKey = filenameToListKey(file)
        const networkKey = `tokens-${networkChainId}-${listKey}`
        const [networkList] = await db.insertList({
          key: networkKey,
          providerId: provider.providerId,
          networkId: utils.chainIdToNetworkId(networkChainId, type),
        })
        this.chainIdToNetworkId.set(networkList.key, networkList)
        lists.push({ listKey: networkKey, listId: networkList.listId })
      }
    }

    // Also pre-create the global format lists (tokens-svg, tokens-pngXX, etc.)
    const possibleGlobalListKeys = ['svg', 'png', 'png128', 'png32']
    for (const listKey of possibleGlobalListKeys) {
      const [list] = await db
        .insertList({
          providerId: provider.providerId,
          key: `tokens-${listKey}`,
          default: listKey === 'svg',
        })
        .catch(() => [null])
      if (list) {
        lists.push({ listKey: `tokens-${listKey}`, listId: list.listId })
      }
    }

    return [{ providerKey, lists }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    if (!this.info) return

    const row = utils.terminal.issue({
      id: providerKey,
      type: terminalRowTypes.SETUP,
    })
    try {
      const { tokens } = this.info

      const [provider] = await db.insertProvider({
        key: providerKey,
        name: 'Smol Dapp',
        description: 'a communitly led initiative to collect all the evm assets',
      })

      // Process chain images
      const chains = await utils.folderContents(this.chainsPath)
      for (const cID of chains) {
        if (cID === '_info.json') continue
        const chainIdIsNumber = !!+cID
        const chainId = chainIdIsNumber ? cID : cID
        if (signal.aborted) return

        if (path.extname(chainId) === '.json') {
          row.increment(terminalCounterTypes.NETWORK, `${chainId}`)
          row.increment('skipped', `${providerKey}-${chainId}`)
          continue
        }

        const networkChainId =
          this.folderToNetworkChainId.get(cID) ?? (chainIdIsNumber ? +chainId : Number(stringToHex(chainId)))
        const type = chainIdIsNumber ? 'evm' : 'btc'
        const network = await db.insertNetworkFromChainId(networkChainId, type)
        const chainFolder = path.join(this.chainsPath, chainId || cID)
        const folders = await utils.folderContents(chainFolder)

        for (const file of folders) {
          if (signal.aborted) return
          const listKey = filenameToListKey(file)
          const networkKey = `tokens-${networkChainId}-${listKey}`
          const networkList = this.chainIdToNetworkId.get(networkKey)
          if (!networkList) continue

          const originalUri = path.join(chainFolder, file)

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
      if (signal.aborted) return

      // Process tokens
      const reverseOrderTokens = Object.entries(tokens).map(
        ([chainIdString, tokens], i) => [chainIdString, tokens, i] as [string, string[], number],
      )
      row.createCounter(terminalCounterTypes.TOKEN)
      row.createCounter(terminalCounterTypes.NETWORK)
      row.incrementTotal(
        terminalCounterTypes.NETWORK,
        utils.mapToSet.network(reverseOrderTokens, ([chainIdString]) => chainIdString),
      )
      const networkLimiter = promiseLimit<[string, string[], number]>(1)
      const tokenLimit = promiseLimit<[Hex, number]>(16)
      const section = row.issue(providerKey)
      let globalOrderId = 0
      for (const [chainIdString, tokens] of reverseOrderTokens) {
        if (signal.aborted) return
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
      await networkLimiter.map(reverseOrderTokens, async ([chainIdString, tokens]) => {
        if (signal.aborted) return

        const chainIdIsNumber = !!+chainIdString
        const type = chainIdIsNumber ? 'evm' : 'btc'
        const networkChainId =
          this.folderToNetworkChainId.get(chainIdString) ?? (+chainIdString || Number(stringToHex(chainIdString)))
        this.folderToNetworkChainId.set(chainIdString, networkChainId)
        const network = await db.insertNetworkFromChainId(networkChainId, type)
        // Pre-compute all possible network lists for this chain to avoid per-token database calls
        const networkListCache = new Map<string, List>()
        const possibleListKeys = ['svg', 'png', 'png128', 'png32'] // Based on actual smoldapp file patterns

        try {
          for (const listKey of possibleListKeys) {
            const networkKey = `tokens-${chainIdString}-${listKey}`
            if (!this.chainIdToNetworkId.has(networkKey)) {
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
                      failureLog('error inserting list %o %o %o', networkKey, networkChainId, type)
                      throw err
                    }),
              )!
              this.chainIdToNetworkId.set(networkKey, networkList)
              networkListCache.set(listKey, networkList)
            } else {
              networkListCache.set(listKey, this.chainIdToNetworkId.get(networkKey)!)
            }
          }
        } catch (err) {
          failureLog('Error building network list cache for chain %o: %o', chainIdString, err)
          return
        }

        const tokensAndIndices = tokens.map((t, i) => [t, i] as [Hex, number])
        await tokenLimit.map(tokensAndIndices, async ([token, i]) => {
          if (signal.aborted) return
          const networkChainId = this.folderToNetworkChainId.get(chainIdString)!
          const task = section.task(`${chainIdString}-${token}`, {
            id: providerKey,
            type: terminalRowTypes.STORAGE,
            kv: {
              chainId: chainIdString,
              token,
            },
          })
          const tokenSignal = AbortSignal.timeout(3_000)
          const combinedSignal = AbortSignal.any([signal, tokenSignal])
          try {
            await processSmoldappToken({
              token,
              i,
              chainIdString,
              chainIdIsNumber,
              type,
              networkChainId,
              tokensPath: this.tokensPath,
              networkListCache,
              provider,
              row,
              signal: combinedSignal,
              globalOrderId: globalOrderId++,
            })
            task.complete()
            row.increment(terminalCounterTypes.TOKEN, utils.counterId.token([+chainIdString, token]))
          } catch (err) {
            const isTimeout = tokenSignal.aborted
            failureLog(
              '%s token %o on chain %o: %o',
              isTimeout ? 'timeout' : 'error',
              token,
              chainIdString,
              (err as Error).message,
            )
            task.complete()
            row.increment('skipped', `${providerKey}-${chainIdString}-${token}-${isTimeout ? 'timeout' : 'error'}`)
          }
        })
        row.increment(terminalCounterTypes.NETWORK, `${chainIdString}`)
      })
      row.hideSection(providerKey)
    } finally {
      row.complete()
    }
  }
}

export default SmoldappCollector

type ProcessTokenParams = {
  token: Hex
  i: number
  chainIdString: string
  chainIdIsNumber: boolean
  type: string
  networkChainId: number
  tokensPath: string
  networkListCache: Map<string, List>
  provider: { providerId: string; key: string }
  row: ReturnType<typeof utils.terminal.issue>
  signal: AbortSignal
  globalOrderId: number
}

const processSmoldappToken = async (params: ProcessTokenParams) => {
  const {
    token,
    i,
    chainIdString,
    chainIdIsNumber,
    type,
    networkChainId,
    tokensPath,
    networkListCache,
    provider,
    row,
    signal,
    globalOrderId,
  } = params
  const tokenFolder = path.join(tokensPath, chainIdString, token.toLowerCase())
  const address = getAddress(utils.commonNativeNames.has(token.toLowerCase() as Hex) ? zeroAddress : token)
  let metadata: [string, string, number] | null = null
  if (chainIdIsNumber) {
    const chain = utils.findChain(+chainIdString)
    if (!chain) {
      return
    }
    const networkId = utils.chainIdToNetworkId(chain.id)
    const { getDrizzle } = await import('../db/drizzle')
    const { eq, and, ne } = await import('drizzle-orm')
    const schemaMod = await import('../db/schema')
    const [existingToken] = await getDrizzle()
      .select({
        name: schemaMod.token.name,
        symbol: schemaMod.token.symbol,
        decimals: schemaMod.token.decimals,
      })
      .from(schemaMod.token)
      .where(
        and(
          eq(schemaMod.token.providedId, address),
          eq(schemaMod.token.networkId, networkId),
          ne(schemaMod.token.name, ''),
          ne(schemaMod.token.symbol, ''),
        ),
      )
      .limit(1)
    if (existingToken) {
      metadata = [existingToken.name, existingToken.symbol, existingToken.decimals]
    } else {
      metadata = await erc20Read(chain, utils.chainToPublicClient(chain), address).catch((error) => {
        failureLog('%o', error)
        return null
      })
    }
  } else if (type === 'btc') {
    metadata = ['Bitcoin', 'BTC', 8]
  }
  if (!metadata) {
    row.increment('missing', utils.counterId.token([networkChainId, token]))
    row.increment('skipped', `${providerKey}-${networkChainId}-${token}-read-error`)
    return
  }
  const [name, symbol, decimals] = metadata
  const tokenImages = (await utils.folderContents(tokenFolder).catch((err) => {
    failureLog('Error getting folder contents for token %o on chain %o: %o', token, networkChainId, err)
    return []
  })) as string[]

  if (!tokenImages.length) {
    row.increment('skipped', `${providerKey}-${chainIdString}-${token}-no-images`)
    return
  }

  const firstImageName = tokenImages[0]
  const listKey = filenameToListKey(firstImageName)
  const networkList = networkListCache.get(listKey)
  if (!networkList) {
    failureLog('Network list not found for listKey: %o on chain %o', listKey, chainIdString)
    row.increment('skipped', `${providerKey}-${chainIdString}-${token}-no-network-list`)
    return
  }
  for (const imageName of tokenImages) {
    if (signal.aborted) {
      throw new Error('aborted')
    }
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
    const [list] = await db
      .insertList({
        providerId: provider.providerId,
        key: `tokens-${listKey}`,
        default: listKey === 'svg',
      })
      .catch((err) => {
        failureLog('Error inserting list for token %o on chain %o: %o', token, chainIdString, err)
        return [null]
      })
    if (!list) {
      row.increment('skipped', `${providerKey}-${chainIdString}-${token}-no-list`)
      return
    }

    await db.transaction(async (tx) => {
      await db.fetchImageAndStoreForToken(
        {
          listId: list.listId,
          ...baseInput,
          listTokenOrderId: globalOrderId,
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
  }
}

/**
 * Main collection function that processes chains and tokens
 */
export const collect = async (signal: AbortSignal) => {
  const collector = new SmoldappCollector()
  await collector.discover(signal)
  await collector.collect(signal)
}
