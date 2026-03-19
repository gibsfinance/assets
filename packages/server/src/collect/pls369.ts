import * as path from 'path'
import { type Hex, isAddress, getAddress } from 'viem'
import { type Chain } from 'viem/chains'
import * as fs from 'fs'
import _ from 'lodash'
import { pulsechain, pulsechainV4 } from 'viem/chains'
import * as paths from '../paths'
import { erc20Read } from '@gibs/utils'
import * as db from '../db'
import promiseLimit from 'promise-limit'
import { chainToPublicClient, counterId, mapToSet, terminal } from '../utils'
import { terminalCounterTypes, terminalRowTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'pls369'
type Piece = {
  address: Hex
  path: string
  fullPath: string
}
type Config = {
  list: {
    default: boolean
    key: string
    name: string
    description: string
  }
  fetchConfig: {
    mustExist: boolean
    skipBytes32: boolean
  }
  chain: Chain
}
const tokenAccessLimit = promiseLimit<[Piece, number]>(32)
const networkLimiter = promiseLimit<Config>(2)
/**
 * Configuration for mainnet and testnet token collection
 */
const configs = [
  {
    list: {
      default: true,
      key: 'repo',
      name: 'pls369',
      description: 'a grass roots list curated by pulsechain users',
    },
    fetchConfig: {
      mustExist: true,
      skipBytes32: false,
    },
    chain: pulsechain,
  },
  {
    list: {
      default: false,
      key: 'repo-testnet',
      name: 'v4pls943',
      description: 'a grass roots list curated by pulsechainV4 users',
    },
    fetchConfig: {
      mustExist: true,
      skipBytes32: true,
    },
    chain: pulsechainV4,
  },
] as Config[]

type Walker = (target: string, doWalk: () => Promise<string[]>) => Promise<string[]>

export const walkFor = async (start: string, fn: Walker): Promise<string[]> => {
  const stats = await fs.promises.readdir(start)
  const limiter = promiseLimit<string>(8)
  const filtered = await limiter.map(stats, (file) => {
    const f = path.join(start, file)
    return fn(f, () => walkFor(f, fn))
  })
  return _.flattenDeep(filtered)
}

class Pls369Collector extends BaseCollector {
  readonly key = 'pls369'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    const [provider] = await db.insertProvider({
      key: providerKey,
      name: 'PLS369',
      description: 'a grass roots list curated by pulsechain users',
    })

    const lists: Array<{ listKey: string }> = []
    for (const { list, chain } of configs) {
      const network = await db.insertNetworkFromChainId(chain.id)
      await db.insertList({
        providerId: provider.providerId,
        networkId: network.networkId,
        ...list,
      })
      lists.push({ listKey: list.key })
    }

    return [{
      providerKey,
      lists,
    }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const summaryRow = terminal.issue({
      id: providerKey,
      type: terminalRowTypes.SETUP,
    })
    try {
      const walkPath = path.join(paths.submodules, 'pulsechain-assets', 'blockchain', 'pulsechain', 'assets')
      const infoFiles = await walkFor(walkPath, async (file, walker) => {
        const stat = await fs.promises.stat(file)
        if (stat.isDirectory()) {
          return walker()
        }
        if (file.includes('.DS_Store')) return []

        if (path.extname(file) !== '.json') {
          return [file]
        }
        return []
      })

      const infoPaths = infoFiles.map((file) => file.split(`${walkPath}`).join(''))
      const pieces = _(infoPaths)
        .map((p, index) => {
          const addr = p.slice(1, 43)
          if (!isAddress(addr)) {
            summaryRow.createCounter('skipped', true)
            summaryRow.increment('skipped', `${providerKey}-${addr.toLowerCase()}`)
            return null
          }
          return [
            {
              address: getAddress(addr),
              path: p,
              fullPath: path.join(walkPath, p),
            },
            index,
          ] as [Piece, number]
        })
        .compact()
        .value()

      const [provider] = await db.insertProvider({
        key: 'pls369',
        name: 'PLS369',
        description: 'a grass roots list curated by pulsechain users',
      })

      summaryRow.createCounter(terminalCounterTypes.NETWORK)
      summaryRow.incrementTotal(
        terminalCounterTypes.NETWORK,
        mapToSet.network(configs, (c) => c.chain.id),
      )
      const section = summaryRow.issue(providerKey)
      await networkLimiter.map(configs, async ({ list, chain, fetchConfig }) => {
        if (signal.aborted) {
          return
        }
        const row = section.task(`${providerKey}-${chain.id}`, {
          id: `chainId=${chain.id}`,
          type: terminalRowTypes.SETUP,
        })
        const client = chainToPublicClient(chain)
        const network = await db.insertNetworkFromChainId(chain.id)
        const [dbList] = await db.insertList({
          providerId: provider.providerId,
          networkId: network.networkId,
          ...list,
        })

        row.createCounter(terminalCounterTypes.TOKEN)
        row.incrementTotal(
          terminalCounterTypes.TOKEN,
          mapToSet.token(pieces, ([v]) => [chain.id, v.address]),
        )
        const networkSection = row.issue(`${providerKey}-${chain.id}`)
        await tokenAccessLimit
          .map(pieces, async ([piece, i]) => {
            if (signal.aborted) {
              return
            }
            const chainTokenId = counterId.token([chain.id, piece.address])
            row.increment(terminalCounterTypes.TOKEN, chainTokenId)
            const task = networkSection.task(chainTokenId, {
              id: '',
              type: terminalRowTypes.STORAGE,
              kv: {
                address: piece.address,
              },
            })
            const response = await erc20Read(chain, client, piece.address, fetchConfig).catch(() => null)

            if (!response) {
              row.increment('skipped', chainTokenId)
              task.unmount()
              return
            }

            const [name, symbol, decimals] = response
            const path = piece.fullPath.replace('hhttps://', 'https://')

            await db
              .fetchImageAndStoreForToken({
                listId: dbList.listId,
                uri: path,
                originalUri: path,
                providerKey: provider.key,
                listTokenOrderId: i,
                signal,
                token: {
                  name,
                  symbol,
                  decimals,
                  networkId: network.networkId,
                  providedId: piece.address,
                },
              })
              .finally(() => {
                task.complete()
              })
          })
          .catch((e) => {
            row.increment('erred', `${chain.id}`)
            summaryRow.increment('erred', `${chain.id}`)
            throw e
          })
        row.hideSection(`${providerKey}-${chain.id}`)
        row.hide()
        row.complete()
        summaryRow.increment(terminalCounterTypes.NETWORK, `${chain.id}`)
      })
    } finally {
      summaryRow.complete()
    }
  }
}

const instance = new Pls369Collector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
