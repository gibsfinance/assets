import { erc20Read, failureLog } from '@gibs/utils'
import * as db from '../db'
import * as types from '../types'
import * as utils from '../utils'
import _ from 'lodash'
import * as viem from 'viem'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { KV, terminalCounterTypes, terminalLogTypes, terminalRowTypes, TerminalSectionProxy } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'

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
  /** rewrite logoURI before fetching (e.g., thumb → large) */
  rewriteLogoURI?: (uri: string) => string
}

/**
 * Two-phase collector for remote token lists.
 * Phase 1 (discover): fetches JSON, creates provider + list rows.
 * Phase 2 (collect): processes tokens + images.
 */
export class RemoteTokenListCollector extends BaseCollector {
  readonly key: string
  private config: Input

  constructor(key: string, config: Input) {
    super()
    this.key = key
    this.config = config
  }

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const { providerKey, listKey, tokenList: tokenListUrl } = this.config

    // Fetch the remote JSON (cached by cachedJSONRequest)
    const tokenList = await db.cachedJSONRequest<types.TokenList>(tokenListUrl, signal, tokenListUrl)
    if (signal.aborted || !tokenList?.tokens) return []

    // Run inmemory discover to create provider + list rows
    await inmemoryTokenlist.discover({
      providerKey,
      listKey,
      tokenList,
      isDefault: this.config.isDefault,
      signal,
    })

    return [
      {
        providerKey,
        lists: [{ listKey }],
      },
    ]
  }

  async collect(signal: AbortSignal): Promise<void> {
    // Delegate to the existing factory collect — upserts are idempotent
    const fn = collect(this.config)
    await fn(signal)
  }
}

/**
 * Main collection function that processes remote token lists and extensions.
 * Kept for backward compatibility with unconverted collectors.
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
    rewriteLogoURI,
  }: Input) =>
  async (signal: AbortSignal) => {
    const id = `${providerKey}/${listKey}`
    const row = ro
      ? ro.task(id, { id, type: terminalRowTypes.SETUP })
      : (utils.terminal.get(id) ??
        utils.terminal.issue({
          type: terminalRowTypes.SETUP,
          id,
        }))
    try {
      const tokenList = await db.cachedJSONRequest<types.TokenList>(tokenListUrl, signal, tokenListUrl)
      if (signal.aborted) return

      if (!tokenList) {
        row.increment(terminalLogTypes.EROR, new Set([id]))
        throw new Error(`Invalid JSON response from ${tokenListUrl}`)
      }

      if (signal.aborted) return

      const blacked = new Set<string>([...blacklist.values()].map((a) => a.toLowerCase()))
      if (!tokenList.tokens) {
        failureLog('%o %o', tokenListUrl, tokenList)
        return
      }
      tokenList.tokens.forEach((token) => {
        if (blacked.has(token.address.toLowerCase())) {
          token.logoURI = ''
        }
        if (rewriteLogoURI && token.logoURI) {
          token.logoURI = rewriteLogoURI(token.logoURI)
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

            // eslint-disable-next-line prefer-const
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
              failureLog('%o %o', item, { name, symbol, decimals })
              row.increment('missing', utils.counterId.token([item.network.id, item.address]))
              return
            }

            if (!image) {
              row.increment('missing', utils.counterId.token([item.network.id, item.address]))
              return
            }
            await db.transaction(async (tx) => {
              const network = await db.insertNetworkFromChainId(item.network.id, undefined, tx)
              if (item.network.isNetworkImage) {
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
      if (signal.aborted) return

      const validExtras = _.compact(extras)
      tokenList.tokens = _.uniqBy([...validExtras, ...tokenList.tokens], 'address')
      row.createCounter(terminalCounterTypes.TOKEN)
      row.incrementTotal(
        terminalCounterTypes.TOKEN,
        new Set(tokenList.tokens.map((token) => utils.counterId.token([token.chainId, token.address]))),
      )
      const result = await inmemoryTokenlist.collect({
        providerKey,
        listKey,
        tokenList,
        isDefault,
        row,
        signal,
      })
      return result
    } finally {
      row.complete()
    }
  }
