/**
 * @title Remote Token List Collector
 * @notice Collects token information from remote token lists with extension support
 * @dev Changes from original version:
 * 1. Added detailed progress tracking with status updates
 * 2. Enhanced error handling for HTTP and JSON parsing
 * 3. Added debug logging for better troubleshooting
 * 4. Improved extension token processing with progress indicators
 */

import * as types from '@/types'
import * as viem from 'viem'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { fetch } from '@/fetch'
import * as db from '@/db'
import * as utils from '@/utils'
import _ from 'lodash'
import debug from 'debug'

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

const updateStatus = (message: string) => {
  process.stdout.write(`\r${' '.repeat(process.stdout.columns || 80)}\r${message}`)
}

/**
 * @notice Main collection function that processes remote token lists and extensions
 * @dev Changes:
 * 1. Added status updates for each phase (fetching, processing, storing)
 * 2. Improved error handling with detailed HTTP status reporting
 * 3. Added progress tracking for extension token processing
 * 4. Enhanced debug logging for failures
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
  async () => {
    updateStatus(`🌐 [${providerKey}] Fetching token list...`)
    try {
      const response = await fetch(tokenListUrl)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
      }

      let tokenList: types.TokenList
      try {
        tokenList = await response.json()
      } catch (e) {
        dbg(`Failed to parse JSON from ${tokenListUrl}:`, e)
        throw new Error(`Invalid JSON response from ${tokenListUrl}: ${e}`)
      }

      const blacked = new Set<string>([...blacklist.values()].map((a) => a.toLowerCase()))
      tokenList.tokens.forEach((token) => {
        if (blacked.has(token.address.toLowerCase())) {
          token.logoURI = ''
        }
      })
      const tokenCount = tokenList.tokens?.length || 0
      updateStatus(`📥 [${providerKey}] Found ${tokenCount} tokens`)

      const extra = extension || []
      if (extra.length > 0) {
        updateStatus(`⚡ [${providerKey}] Processing ${extra.length} extension tokens...`)
      }

      let processedCount = 0
      const extras = await Promise.all(
        extra.map(async (item) => {
          if (blacked.has(item.address.toLowerCase())) {
            item.logoURI = ''
          }
          try {
            const chain = utils.findChain(item.network.id) as viem.Chain
            const client = utils.publicClient(chain)
            updateStatus(
              `🔄 [${providerKey}] Processing token ${processedCount + 1}/${extra.length} on ${chain.name}...`,
            )

            const [image, [name, symbol, decimals]] = await Promise.all([
              db.fetchImage(item.logoURI, providerKey, item.address),
              utils.erc20Read(chain, client, item.address),
            ])

            if (!image) {
              dbg(`No image found for token ${item.address} on chain ${item.network.id}`)
              return
            }
            await db.transaction(async (tx) => {
              const network = await db.insertNetworkFromChainId(item.network.id, undefined, tx)
              if (item.network.isNetworkImage) {
                updateStatus(`🖼️  [${providerKey}] Storing network image for ${chain.name}...`)
                await db.fetchImageAndStoreForNetwork(
                  {
                    chainId: item.network.id,
                    uri: image,
                    originalUri: item.logoURI,
                    providerKey,
                  },
                  tx,
                )
              }

              updateStatus(`💾 [${providerKey}] Storing token ${name} (${symbol})...`)
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

            processedCount++
            return {
              chainId: item.network.id,
              logoURI: item.logoURI,
              name,
              symbol,
              decimals,
              address: item.address,
            }
          } catch (err) {
            dbg(`Failed to process extension item ${item.address}:`, err)
            return undefined
          }
        }),
      )

      const validExtras = _.compact(extras)
      updateStatus(`📦 [${providerKey}] Storing ${tokenCount + validExtras.length} total tokens...`)
      tokenList.tokens.push(...validExtras)

      const result = await inmemoryTokenlist.collect(providerKey, listKey, tokenList, isDefault)
      updateStatus(`✨ [${providerKey}] Collection complete!`)
      // process.stdout.write('\n')
      return result
    } catch (err) {
      // process.stdout.write('\n')
      dbg(`Failed to collect tokens for ${providerKey}:`, err)
      throw err
    }
  }
