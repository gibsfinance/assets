import * as path from 'path'
import { type Hex, isAddress, getAddress, zeroAddress } from 'viem'
import { type Chain } from 'viem/chains'
import * as fs from 'fs'
import _ from 'lodash'
import { pulsechain, pulsechainV4 } from 'viem/chains'
import * as paths from '@/paths'
import { erc20Read, timeout } from '@gibs/utils'
import * as db from '@/db'
import promiseLimit from 'promise-limit'
import { chainToPublicClient, terminal } from '@/utils'
import { terminalCounterTypes, terminalRowTypes } from '@/log/types'

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
const tokenAccessLimit = promiseLimit<Piece>(32)
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
] as const

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

/**
 * Main collection function that processes PulseChain assets
 */
export const collect = async () => {
  const summaryRow = terminal.issue({
    id: providerKey,
    type: terminalRowTypes.SETUP,
  })

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
    .map((p) => {
      const addr = p.slice(1, 43)
      if (!isAddress(addr)) {
        summaryRow.createCounter('skipped', true)
        summaryRow.increment('skipped', `${providerKey}-${addr.toLowerCase()}`)
        return null
      }
      return {
        address: getAddress(addr),
        path: p,
        fullPath: path.join(walkPath, p),
      }
    })
    .compact()
    .value()

  const [provider] = await db.insertProvider({
    key: 'pls369',
    name: 'PLS369',
    description: 'a grass roots list curated by pulsechain users',
  })

  // let configIndex = 0
  summaryRow.createCounter(terminalCounterTypes.NETWORK)
  summaryRow.incrementTotal(terminalCounterTypes.NETWORK, configs.length)
  const section = summaryRow.issue(providerKey)
  await networkLimiter.map(configs, async ({ list, chain, fetchConfig }) => {
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
    row.incrementTotal(terminalCounterTypes.TOKEN, pieces.length)
    const networkSection = row.issue(`${providerKey}-${chain.id}`)
    await tokenAccessLimit
      .map(pieces, async (piece: Piece) => {
        const chainTokenId = `${chain.id}-${piece.address.toLowerCase()}`
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
  summaryRow.complete()
}
