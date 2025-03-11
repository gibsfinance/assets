/**
 * @title Remote Token List Collector
 * @notice Collects token information from remote token lists with extension support
 * @dev Changes from original version:
 * 1. Added detailed progress tracking with status updates
 * 2. Enhanced error handling for HTTP and JSON parsing
 * 3. Added debug logging for better troubleshooting
 * 4. Improved extension token processing with progress indicators
 */

import * as db from '@/db'
import { fetch } from '@/fetch'
import * as types from '@/types'
import * as utils from '@/utils'
import debug from 'debug'
import _ from 'lodash'
import * as viem from 'viem'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'
import * as inmemoryTokenlist from './inmemory-tokenlist'

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
  ({ providerKey, listKey, tokenList: tokenListUrl, extension, isDefault = true }: Input) =>
  async () => {
    updateStatus({
      provider: providerKey,
      message: `Fetching token list from ${tokenListUrl}...`,
      phase: 'setup',
    } satisfies StatusProps)

    try {
      const response = await fetch(tokenListUrl)
      if (!response.ok) {
        updateStatus({
          provider: providerKey,
          message: `Failed to fetch token list: ${response.status} ${response.statusText}`,
          phase: 'complete',
        } satisfies StatusProps)
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`)
      }

      let tokenList: types.TokenList
      try {
        tokenList = await response.json()
      } catch (e) {
        updateStatus({
          provider: providerKey,
          message: `Failed to parse token list JSON: ${e}`,
          phase: 'complete',
        } satisfies StatusProps)
        dbg(`Failed to parse JSON from ${tokenListUrl}:`, e)
        throw new Error(`Invalid JSON response from ${tokenListUrl}: ${e}`)
      }

      const tokenCount = tokenList.tokens?.length || 0
      updateStatus({
        provider: providerKey,
        message: `Found ${tokenCount} tokens in list`,
        phase: 'setup',
      } satisfies StatusProps)

      const extra = extension || []
      if (extra.length > 0) {
        updateStatus({
          provider: providerKey,
          message: `Processing ${extra.length} extension tokens...`,
          phase: 'processing',
        } satisfies StatusProps)
      }

      const extras = await Promise.all(
        extra.map(async (item, index) => {
          updateStatus({
            provider: providerKey,
            message: `Processing extension token ${item.address}`,
            current: index + 1,
            total: extra.length,
            phase: 'processing',
          } satisfies StatusProps)

          try {
            const chain = utils.findChain(item.network.id) as viem.Chain
            const client = utils.publicClient(chain)

            const [image, [name, symbol, decimals]] = await Promise.all([
              db.fetchImage(item.logoURI, providerKey),
              utils.erc20Read(chain, client, item.address),
            ])

            if (!image) {
              dbg(`No image found for token ${item.address} on chain ${item.network.id}`)
              return
            }

            const network = await db.insertNetworkFromChainId(item.network.id)
            if (item.network.isNetworkImage) {
              updateStatus({
                provider: providerKey,
                message: `Storing network image for ${chain.name}`,
                current: index + 1,
                total: extra.length,
                phase: 'storing',
              } satisfies StatusProps)

              await db.fetchImageAndStoreForNetwork({
                chainId: item.network.id,
                uri: image,
                originalUri: item.logoURI,
                providerKey,
              })
            }

            updateStatus({
              provider: providerKey,
              message: `Storing token ${symbol} (${name})`,
              current: index + 1,
              total: extra.length,
              phase: 'storing',
            } satisfies StatusProps)

            await db.fetchImageAndStoreForToken({
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
            updateStatus({
              provider: providerKey,
              message: `Failed to process extension token ${item.address}: ${errorMessage}`,
              current: index + 1,
              total: extra.length,
              phase: 'processing',
            } satisfies StatusProps)
            dbg(`Failed to process extension item ${item.address}:`, err)
            return undefined
          }
        }),
      )

      const validExtras = _.compact(extras)
      updateStatus({
        provider: providerKey,
        message: `Storing ${tokenCount + validExtras.length} total tokens...`,
        phase: 'storing',
      } satisfies StatusProps)

      tokenList.tokens.push(...validExtras)

      const result = await inmemoryTokenlist.collect(providerKey, listKey, tokenList, isDefault)

      updateStatus({
        provider: providerKey,
        message: `Successfully processed ${tokenCount + validExtras.length} tokens`,
        phase: 'complete',
      } satisfies StatusProps)

      return result
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      updateStatus({
        provider: providerKey,
        message: `Collection failed: ${errorMessage}`,
        phase: 'complete',
      } satisfies StatusProps)
      dbg(`Failed to collect tokens for ${providerKey}:`, err)
      throw err
    }
  }
