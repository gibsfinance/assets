import * as path from 'path'
import * as types from '@/types'
import * as viem from 'viem'
import * as fs from 'fs'
import * as utils from '@/utils'
import _ from 'lodash'
import { pulsechain } from 'viem/chains'

type Walker = (target: string, doWalk: () => string[]) => string[]

const walkFor = (start: string, fn: Walker): string[] => {
  const stats = fs.readdirSync(start)
  const filtered = stats.map((file) => {
    const f = path.join(start, file)
    return fn(f, () => walkFor(f, fn))
  })
  return _.flattenDeep(filtered)
}

export const collect = async () => {
  const walkPath = path.join(utils.root, 'submodules', 'pulsechain-assets', 'blockchain', 'pulsechain', 'assets')
  const infoFiles = walkFor(walkPath, (file, walker) => {
    const stat = fs.statSync(file)
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
  const entries: types.TokenEntry[] = []
  // const chainId = 369
  const client = viem.createClient({
    chain: pulsechain,
    transport: viem.http(pulsechain.rpcUrls.default.http[0]),
  })
  await utils.limit.map(pieces, async (piece: { fullPath: string; address: viem.Hex }) => {
    const image = fs.readFileSync(piece.fullPath)
    const version = utils.calculateHash(image)
    const writeResult = await utils.tokenImage.update(pulsechain.id, piece.address, image, {
      version,
    })
    if (!writeResult) return
    const multicall = await utils
      .multicallRead<[string, string, number]>({
        chain: pulsechain,
        client,
        abi: viem.erc20Abi,
        calls: [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }],
        target: piece.address,
      })
      .catch(async () => {
        return utils
          .multicallRead<[viem.Hex, viem.Hex, number]>({
            chain: pulsechain,
            client,
            abi: viem.erc20Abi_bytes32,
            calls: [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }],
            target: piece.address,
          })
          .then(
            ([name, symbol, decimals]) =>
              [
                viem.fromHex(name, 'string').split('\x00').join(''),
                viem.fromHex(symbol, 'string').split('\x00').join(''),
                decimals,
              ] as const,
          )
      })
      .catch(() => ['', '', 18] as const)
    const [name, symbol, decimals] = multicall
    entries.push({
      address: piece.address,
      chainId: pulsechain.id,
      name,
      symbol,
      decimals,
      logoURI: utils.tokenImage.path(pulsechain.id, piece.address, {
        outRoot: true,
        version,
        ext: path.extname(writeResult.path),
      }),
    })
  })
  const { path: providerLinkPath } = await utils.providerLink.update('pls369', pulsechain.id, entries)
  return providerLinkPath
}
