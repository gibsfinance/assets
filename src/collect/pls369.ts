import * as path from 'path'
import * as viem from 'viem'
import * as fs from 'fs'
import * as utils from '@/utils'
import _ from 'lodash'
import { pulsechain, pulsechainV4 } from 'viem/chains'
import * as db from '@/db'
import promiseLimit from 'promise-limit'

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

export const collect = async () => {
  const walkPath = path.join(utils.root, 'submodules', 'pulsechain-assets', 'blockchain', 'pulsechain', 'assets')
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
  const paths = infoFiles.map((file) => file.split(`${walkPath}`).join(''))
  const pieces = _(paths)
    .map((p) => {
      const addr = p.slice(1, 43)
      if (addr !== '0xA1077a294dDE1B09bB078844df40758a5D0f9a27') {
        return null
      }
      if (!viem.isAddress(addr)) return null
      return {
        address: viem.getAddress(addr),
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
  await Promise.all(
    configs.map(async ({ list, chain, fetchConfig }) => {
      const client = viem.createClient({
        chain: chain,
        transport: viem.http(),
      })
      const network = await db.insertNetworkFromChainId(chain.id)
      const [dbList] = await db.insertList({
        providerId: provider.providerId,
        networkId: network.networkId,
        ...list,
      })

      await utils.spinner(provider.key, async (l) => {
        l.incrementMax(pieces.length)
        for (const piece of pieces) {
          const response = await utils
            .erc20Read(chain, client, piece.address, fetchConfig) // ignore errors that get to here
            .catch(() => null)
          l.incrementCurrent()
          if (!response) continue
          const [name, symbol, decimals] = response
          const path = piece.fullPath.replace('hhttps://', 'https://')
          await db.fetchImageAndStoreForToken({
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
          if (chain.id !== 369 || piece.address !== '0xA1077a294dDE1B09bB078844df40758a5D0f9a27') {
            return
          }
          const testNetwork = await db.insertNetworkFromChainId(pulsechainV4.id)
          const [dbList2] = await db.insertList({
            providerId: provider.providerId,
            networkId: testNetwork.networkId,
            ...list,
          })
          await db.fetchImageAndStoreForToken({
            listId: dbList2.listId,
            uri: path,
            originalUri: path,
            providerKey: provider.key,
            token: {
              name,
              symbol,
              decimals,
              networkId: testNetwork.networkId,
              providedId: '0x70499adEBB11Efd915E3b69E700c331778628707',
            },
          })
          await db.fetchImageAndStoreForToken({
            listId: dbList2.listId,
            uri: path,
            originalUri: path,
            providerKey: provider.key,
            token: {
              name,
              symbol,
              decimals,
              networkId: testNetwork.networkId,
              providedId: viem.zeroAddress,
            },
          })
          await db.fetchImageAndStoreForToken({
            listId: dbList.listId,
            uri: path,
            originalUri: path,
            providerKey: provider.key,
            token: {
              name,
              symbol,
              decimals,
              networkId: network.networkId,
              providedId: viem.zeroAddress,
            },
          })
          await db.fetchImageAndStoreForNetwork({
            chainId: pulsechainV4.id,
            uri: path,
            originalUri: path,
            providerKey: provider.key,
          })
        }
      })
    }),
  )
}
