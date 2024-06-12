import * as path from 'path'
import * as viem from 'viem'
import * as fs from 'fs'
import * as utils from '@/utils'
import _ from 'lodash'
import { pulsechain } from 'viem/chains'
import * as db from '@/db'
import promiseLimit from 'promise-limit'

type Walker = (target: string, doWalk: () => Promise<string[]>) => Promise<string[]>

const walkFor = async (start: string, fn: Walker): Promise<string[]> => {
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
      if (!viem.isAddress(addr)) return null
      return {
        address: viem.getAddress(addr),
        path: p,
        fullPath: path.join(walkPath, p),
      }
    })
    .compact()
    .value()
  const client = viem.createClient({
    chain: pulsechain,
    transport: viem.http(),
  })
  const provider = await db.insertProvider({
    key: 'pls369',
    name: 'PLS369',
    description: 'a grass roots list curated by pulsechain users',
  })
  await utils.spinner(provider.key, async () => {
    const network = await db.insertNetworkFromChainId(pulsechain.id)
    const list = await db.insertList({
      providerId: provider.providerId,
      networkId: network.networkId,
      name: 'pls369',
      description: 'a grass roots list curated by pulsechain users',
    })
    await utils.limit.map(pieces, async (piece: { fullPath: string; address: viem.Hex }) => {
      const [name, symbol, decimals] = await utils.erc20Read(pulsechain, client, piece.address)
      await db.fetchImageAndStoreForToken({
        listId: list.listId,
        uri: piece.fullPath,
        originalUri: piece.fullPath,
        providerKey: provider.key,
        token: {
          name, symbol, decimals,
          networkId: network.networkId,
          providedId: piece.address,
        },
      })
    })
  })
}
