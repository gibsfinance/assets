import { erc20Read, failureLog } from '@gibs/utils'
import * as db from '../db'
import { fetch } from '../fetch'
import * as types from '../types'
import * as utils from '../utils'
import _ from 'lodash'
import * as viem from 'viem'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { KV, terminalCounterTypes, terminalLogTypes, TerminalRowProxy, terminalRowTypes, TerminalSectionProxy } from '../log/types'

type Extension = {
  address: viem.Hex
  logoURI: string
  name?: string
  symbol?: string
  decimals?: number
  network: {
    id: number
    isNetworkImage: boolean
  }
}

type Input = {
  row?: TerminalSectionProxy
  extension?: Extension[]
  providerKey: string
  tokenList: string
  listKey: string
  isDefault?: boolean
  /** a list of addresses to blacklist images to speed up load time */
  blacklist?: Set<string>
}

/**
 * Main collection function that processes remote token lists and extensions
 */
export const collect =
  ({
    providerKey,
    listKey,
    tokenList: tokenListUrl,
    extension,
    isDefault = true,
    blacklist = new Set<string>(),
    row: ro,
  }: Input) =>
    async (signal: AbortSignal) => {
      const id = `${providerKey}/${listKey}`
      const row = ro ? ro.task(id, { id, type: terminalRowTypes.SETUP }) :
        (utils.terminal.get(id) ??
          utils.terminal.issue({
            type: terminalRowTypes.SETUP,
            id,
          }))
      const tokenList = await db.cachedJSONRequest<types.TokenList>(
        tokenListUrl,
        tokenListUrl,
        { signal },
      )
      if (signal.aborted) {
        return
      }

      if (!tokenList) {
        row.increment(terminalLogTypes.EROR, new Set([id]))
        row.complete()
        throw new Error(`Invalid JSON response from ${tokenListUrl}`)
      }

      if (signal.aborted) {
        row.complete()
        return
      }

      const blacked = new Set<string>([...blacklist.values()].map((a) => a.toLowerCase()))
      tokenList.tokens.forEach((token) => {
        if (blacked.has(token.address.toLowerCase())) {
          token.logoURI = ''
        }
      })
      const kv: KV = {}
      if (blacked.size) {
        kv.blacklisted = blacked.size
      }
      row.update({
        kv,
      })
      const extra = extension || []
      if (extra.length) {
        kv.extensions = extra.length
        row.update({
          kv,
        })
      }
      row.createCounter(terminalCounterTypes.NETWORK)
      const extras = await Promise.all(
        extra.map(async (item) => {
          if (signal.aborted) {
            return
          }
          if (blacked.has(item.address.toLowerCase())) {
            item.logoURI = ''
          }
          try {
            const chain = utils.findChain(item.network.id) as viem.Chain
            const client = utils.chainToPublicClient(chain)

            let [image, [name = item.name, symbol = item.symbol, decimals = item.decimals]] = await Promise.all([
              db.fetchImage(item.logoURI, signal, providerKey, item.address),
              erc20Read(chain, client, item.address),
            ])
            if (item.network.isNetworkImage && (!name || !symbol)) {
              name = item.name!
              symbol = item.symbol!
              decimals = item.decimals!
            }
            if (!name || !symbol || !decimals) {
              console.log(item, { name, symbol, decimals })
              row.increment('missing', utils.counterId.token([item.network.id, item.address]))
              return
            }

            if (!image) {
              row.increment('missing', utils.counterId.token([item.network.id, item.address]))
              // dbg(`No image found for token ${item.address} on chain ${item.network.id}`)
              return
            }
            await db.transaction(async (tx) => {
              const network = await db.insertNetworkFromChainId(item.network.id, undefined, tx)
              if (item.network.isNetworkImage) {
                // updateStatus({
                //   provider: providerKey,
                //   message: `Storing network image for ${chain.name}...`,
                //   phase: 'storing',
                // } satisfies StatusProps)
                await db.fetchImageAndStoreForNetwork(
                  {
                    network,
                    uri: image,
                    originalUri: item.logoURI,
                    providerKey,
                    signal,
                  },
                  tx,
                )
              }
            })
            return {
              chainId: item.network.id,
              logoURI: item.logoURI,
              name,
              symbol,
              decimals,
              address: item.address,
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            failureLog('provider=%o list=%o item=%o error=%o', providerKey, listKey, item, errorMessage)
            row.increment(terminalLogTypes.EROR, new Set([utils.counterId.token([item.network.id, item.address])]))
            return undefined
          } finally {
            row.increment(terminalCounterTypes.TOKEN, new Set([utils.counterId.token([item.network.id, item.address])]))
          }
        }),
      )
      if (signal.aborted) {
        row.complete()
        return
      }

      const validExtras = _.compact(extras)
      tokenList.tokens = _.uniqBy([...validExtras, ...tokenList.tokens], 'address')
      row.createCounter(terminalCounterTypes.TOKEN)
      row.incrementTotal(terminalCounterTypes.TOKEN, new Set(tokenList.tokens.map(token => utils.counterId.token([token.chainId, token.address]))))
      const result = await inmemoryTokenlist.collect({
        providerKey,
        listKey,
        tokenList,
        isDefault,
        row,
        signal,
      })
      row.complete()
      row.hide()
      return result
    }
