import * as chains from 'viem/chains'
import * as viem from 'viem'
import * as path from 'path'
import * as utils from '@/utils'
import type { InternetMoneyNetwork, Todo, TokenEntry } from '@/types'
import { fetch } from '@/fetch'
import * as db from '@/db'
import { tableNames } from '@/db/tables'
import _ from 'lodash'

const baseUrl = 'https://im-wallet.herokuapp.com/api/v1/networks'

export const collect = async () => {
  return await utils.spinner('internetmoney', async () => {
    const json = await fetch(baseUrl).then((res): Promise<InternetMoneyNetwork[]> => res.json())
    const todos: Todo[] = []
    const entries: TokenEntry[] = []
    for (const network of json) {
      ; ((network) => {
        todos.push(async () => {
          const iconBlob = await fetch(network.icon).then(utils.responseToBuffer)
          await utils.networkImage.update(network.chainId, iconBlob)
        })
        let chain = utils.findChain(network.chainId)
        if (!chain) {
          chain = {
            id: network.chainId,
            contracts: chains.mainnet.contracts,
            rpcUrls: {
              default: {
                http: [network.rpc],
              },
            },
          } as unknown as viem.Chain
        }
        const client = viem.createClient({
          transport: viem.http(chain.rpcUrls.default.http[0]),
          chain,
        })
        todos.push(
          ...network.tokens.map((token) => async () => {
            const address = token.address as viem.Hex
            const erc20 = viem.getContract({
              abi: viem.erc20Abi,
              address,
              client,
            })
            const image = await fetch(token.icon).then(utils.responseToBuffer)
            const writeResult = await utils.tokenImage.update(network.chainId, address, image)
            if (!writeResult) {
              return
            }
            const { path: outPath } = writeResult
            const [name, symbol, decimals] = await utils
              .multicallRead<[string, string, number]>({
                chain,
                client,
                abi: viem.erc20Abi,
                calls: [{ functionName: 'name' }, { functionName: 'symbol' }, { functionName: 'decimals' }],
                target: address,
              })
              .catch(() => {
                return ['', '', 0]
              })
            const entry = {
              chainId: network.chainId,
              address,
              name: name || (await erc20.read.name().catch(() => '')),
              symbol: symbol || token.symbol,
              decimals: decimals || token.decimals,
              logoURI: utils.tokenImage.path(chain.id, address, {
                version: utils.calculateHash(image),
                outRoot: true,
                ext: path.extname(outPath),
              }),
            } as TokenEntry
            entries.push(entry)
          }),
        )
      })(network)
    }
    await utils.limit.map(todos, (fn) => utils.retry(fn))
    const networks = await db.getDB().select('*')
      .from(tableNames.network)
      .whereILike('type', 'evm')
    const chainIdToNetwork = new Map<number, string>(networks.map((n) =>))
    const tokens = _(entries).map((entry) => ({
      networkId: chainIdToNetwork.get(entry.chainId),
      providedId: entry.address,
    }))
      .uniqBy((e) => `${e.networkId}.${e.providedId}`).value()
    await db.transaction(async (t) => {
      await t(tableNames.token)
        .insert(tokens)
        .returning('*')
    })
    return []
    // const entries =
    // return await utils.limit.map(groupedEntries, async (entry) => {
    //   const { path: providerListPath } = await utils.providerLink.update('internetmoney', chainId, entries)
    //   return providerListPath
    // })
  })
}
