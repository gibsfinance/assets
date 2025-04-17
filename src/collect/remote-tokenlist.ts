import { erc20Read, failureLog } from '@gibs/utils'
import * as db from '@/db'
import { fetch } from '@/fetch'
import * as types from '@/types'
import * as utils from '@/utils'
import debug from 'debug'
import _ from 'lodash'
import * as viem from 'viem'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { KV, terminalCounterTypes, terminalLogTypes, terminalRowTypes } from '@/log/types'

const dbg = debug('📷:remote-tokenlist')

type Extension = {
  address: viem.Hex
  logoURI: string
  network: {
    id: number
    isNetworkImage: boolean
  }
}

type Input = {
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
  }: Input) =>
  async (signal: AbortSignal) => {
    const id = `${providerKey}/${listKey}`
    const row =
      utils.terminal.get(id) ??
      utils.terminal.issue({
        type: terminalRowTypes.SETUP,
        id,
      })
    row.update({
      message: 'fetching list',
    })
    const response = await fetch(tokenListUrl, { signal })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
    }

    let tokenList: types.TokenList
    try {
      tokenList = await response.json()
    } catch (e) {
      failureLog('provider=%o list=%o error=%o', providerKey, listKey, (e as Error).message)
      return
      // throw new Error(`Invalid JSON response from ${tokenListUrl}: ${e}`)
    }
    if (signal.aborted) {
      return
    }

    const blacked = new Set<string>([...blacklist.values()].map((a) => a.toLowerCase()))
    tokenList.tokens.forEach((token) => {
      if (blacked.has(token.address.toLowerCase())) {
        token.logoURI = ''
      }
    })
    let kv: KV = {}
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

          const [image, [name, symbol, decimals]] = await Promise.all([
            db.fetchImage(item.logoURI, signal, providerKey, item.address),
            erc20Read(chain, client, item.address),
          ])

          if (!image) {
            row.increment('missing', `${item.network.id}-${item.address.toLowerCase()}`)
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
                },
                tx,
              )
            }

            await db.fetchImageAndStoreForToken(
              {
                listId: null,
                uri: image,
                originalUri: item.logoURI,
                providerKey,
                token: {
                  name,
                  symbol,
                  decimals,
                  providedId: item.address,
                  networkId: network.networkId,
                },
              },
              tx,
            )
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
          row.increment(terminalLogTypes.EROR, `${item.network.id}-${item.address.toLowerCase()}`)
          return undefined
        } finally {
          row.increment(terminalCounterTypes.TOKEN, `${item.network.id}-${item.address.toLowerCase()}`)
        }
      }),
    )

    const validExtras = _.compact(extras)
    // updateStatus({
    //   provider: providerKey,
    //   message: `Storing ${tokenCount + validExtras.length} total tokens...`,
    //   phase: 'storing',
    // } satisfies StatusProps)

    tokenList.tokens.push(...validExtras)

    if (signal.aborted) {
      return
    }
    const result = await inmemoryTokenlist.collect({
      providerKey,
      listKey,
      tokenList,
      isDefault,
      signal,
    })
    // updateStatus({
    //   provider: providerKey,
    //   message: 'Collection complete!',
    //   phase: 'complete',
    // } satisfies StatusProps)
    // process.stdout.write('\n')
    return result
    // } catch (err) {
    // process.stdout.write('\n')
    // dbg(`Failed to collect tokens for ${providerKey}:`, err)
    // throw err
  }
