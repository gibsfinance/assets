import _ from 'lodash'
import * as chains from 'viem/chains'
import * as viem from 'viem'
import * as path from 'path'
import * as utils from '../utils'
import { InternetMoneyNetwork, Todo, TokenEntry } from '../types'

export const scrape = async () => {
  const baseUrl = 'https://im-wallet.herokuapp.com/api/v1/networks'
  const json = await fetch(baseUrl).then((res): Promise<InternetMoneyNetwork[]> => res.json())
  const todos: Todo[] = []
  const entries: TokenEntry[] = []
  for (const network of json) {
    ((network) => {
      todos.push(async () => {
        const iconBlob = await fetch(network.icon).then(utils.responseToBuffer)
        await utils.networkImage.update(network.chainId, iconBlob, {
          setLatest: false,
        })
      })
      let chain = utils.findChain(network.chainId)
      if (!chain) {
        console.log('missing %o - %o', network.chainId, network.networkName)
        chain = {
          id: network.chainId,
          contracts: chains.mainnet.contracts,
          rpcUrls: {
            default: {
              http: [network.rpc],
            }
          }
        } as unknown as viem.Chain
      }
      const client = viem.createClient({
        transport: viem.http(chain.rpcUrls.default.http[0]),
        chain,
      })
      todos.push(...network.tokens.map((token) => async () => {
        const address = token.address as viem.Hex
        const erc20 = viem.getContract({
          abi: viem.erc20Abi,
          address,
          client,
        })
        const image = await fetch(token.icon).then(utils.responseToBuffer)
        const { path: outPath } = await utils.tokenImage.update(network.chainId, address, image)
        const [name, symbol, decimals] = await utils.multicallRead<[string, string, number]>({
          chain,
          client,
          abi: viem.erc20Abi,
          calls: [
            { functionName: 'name' },
            { functionName: 'symbol' },
            { functionName: 'decimals' },
          ],
          target: address,
        }).catch((err) => {
          return ['', '', 0]
        })
        const entry = {
          chainId: network.chainId,
          address,
          name: name || await erc20.read.name().catch(() => ''),
          symbol: symbol || token.symbol,
          decimals: decimals || token.decimals,
          logoURI: utils.tokenImage.path(chain.id, address, {
            version: utils.calculateHash(image),
            outRoot: true,
            ext: path.extname(outPath).slice(1),
          }),
        } as TokenEntry
        entries.push(entry)
      }))
    })(network)
  }
  await utils.limit.map(todos, (fn) => utils.retry(fn))
  const sortedEntries = entries.sort(utils.sortTokenEntry)
  const { path: providerListPath } = await utils.providerLink.update('internetmoney', sortedEntries)
  return providerListPath
}
