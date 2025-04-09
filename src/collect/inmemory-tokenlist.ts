/**
 * @title In-Memory Token List Processor
 * @notice Processes token lists with enhanced reliability and performance
 * @dev Changes from original version:
 * 1. Added retry mechanism with exponential backoff
 * 2. Implemented batched processing for better memory management
 * 3. Added detailed status updates and progress tracking
 * 4. Enhanced error handling with transaction timeouts
 */

import * as db from '@/db'
import * as types from '@/types'
import * as utils from '@/utils'
import { clearStatus, stop, updateStatus } from '@/utils/status'
import type { List, Network, Provider } from 'knex/types/tables'

/**
 * @notice Configuration constants for performance tuning
 * @dev Changes:
 * 1. Reduced batch size from 100 to 25 for better stability
 * 2. Added statement timeout to prevent hanging transactions
 * 3. Implemented configurable retry attempts
 */
const MAX_RETRIES = 3
const BATCH_SIZE = 25
const STATEMENT_TIMEOUT = 300000 // 5 minutes

/**
 * @notice Generic retry wrapper with exponential backoff
 * @dev Added to improve reliability:
 * 1. Implements exponential backoff between retries
 * 2. Configurable maximum retry attempts
 * 3. Preserves original error context
 */
async function withRetry<T>(operation: () => Promise<T>, retryCount = 0): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      throw error
    }
    const delay = Math.pow(2, retryCount) * 1000
    await new Promise((resolve) => setTimeout(resolve, delay))
    return withRetry(operation, retryCount + 1)
  }
}

/**
 * @notice Main collection function for processing token lists
 * @dev Changes:
 * 1. Added batched processing with configurable batch size
 * 2. Implemented transaction timeouts for better error handling
 * 3. Added detailed progress tracking for tokens
 * 4. Enhanced URL handling for malformed image URLs
 * 5. Added blacklist handling for problematic images
 */
export const collect = async (providerKey: string, listKey: string, tokenList: types.TokenList, isDefault = true) => {
  try {
    // Extract unique chain IDs from token list
    const chainIdSet = new Set<number>()
    for (const entry of tokenList.tokens) {
      chainIdSet.add(+entry.chainId)
    }
    const chainIds = [...chainIdSet.values()]
    const networks = new Map<number, Network>()

    // Initialize database entries
    updateStatus({
      provider: providerKey,
      message: 'Setting up database entries...',
      phase: 'setup',
    })
    let provider!: Provider
    let list!: List

    /**
     * Initial setup transaction:
     * 1. Creates networks for each chain ID
     * 2. Creates provider entry
     * 3. Creates list entry
     * 4. Stores list logo if available
     */
    await withRetry(async () => {
      await db.transaction(async (tx) => {
        await tx.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT}`)

        // Setup default network (chainId 0)
        await db.insertNetworkFromChainId(0, undefined, tx)

        // Setup networks for each chain ID
        for (const chainId of chainIds) {
          if (chainId) {
            updateStatus({
              provider: providerKey,
              message: `Setting up chain ${chainId}...`,
              phase: 'setup',
            })
            const network = await db.insertNetworkFromChainId(chainId, undefined, tx)
            networks.set(chainId, network)
          }
        }

        // Create provider entry
        ;[provider] = await db.insertProvider(
          {
            key: providerKey,
          },
          tx,
        )

        // Create list entry
        ;[list] = await db.insertList(
          {
            providerId: provider.providerId,
            networkId: utils.chainIdToNetworkId(chainIds.length === 1 ? chainIds[0] : 0),
            name: tokenList.name,
            key: listKey,
            default: isDefault,
            description: '',
            ...(tokenList.version || {}),
          },
          tx,
        )

        // Store list logo if available
        if (tokenList.logoURI) {
          updateStatus({
            provider: providerKey,
            message: 'Storing list logo...',
            phase: 'setup',
          })
          await db.fetchImageAndStoreForList(
            {
              listId: list.listId,
              uri: tokenList.logoURI,
              originalUri: tokenList.logoURI,
              providerKey,
            },
            tx,
          )
        }
      })
    })

    // Process tokens in batches
    let processedTokens = 0
    const totalTokens = tokenList.tokens.length
    const blacklist = new Set<string>(['missing_large.png', 'missing_thumb.png'])

    updateStatus({
      provider: providerKey,
      message: 'Setting up token processing...',
      phase: 'setup',
    })

    /**
     * Token processing:
     * 1. Process tokens in batches to manage memory and database load
     * 2. Each token is processed in its own transaction with retry logic
     * 3. Stores token information and associated images
     */
    for (let i = 0; i < totalTokens; i += BATCH_SIZE) {
      const batch = tokenList.tokens.slice(i, i + BATCH_SIZE)

      await withRetry(async () => {
        await db.transaction(async (tx) => {
          await tx.raw(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT}`)

          for (const entry of batch) {
            processedTokens++

            updateStatus({
              provider: providerKey,
              message: `Processing token: ${entry.symbol}...`,
              current: processedTokens,
              total: totalTokens,
              phase: 'processing',
            })

            const network = networks.get(entry.chainId)!
            const token = {
              name: entry.name,
              symbol: entry.symbol,
              decimals: entry.decimals,
              networkId: network.networkId,
              providedId: entry.address,
            }

            // Skip blacklisted images
            if (blacklist.has(entry.logoURI as string)) {
              entry.logoURI = ''
            }

            // Fix malformed URLs and store token image
            const path = entry.logoURI?.replace('hhttps://', 'https://') || null
            if (path) {
              updateStatus({
                provider: providerKey,
                message: `Storing token: ${entry.symbol}...`,
                current: processedTokens,
                total: totalTokens,
                phase: 'storing',
              })
            }
            await db.fetchImageAndStoreForToken(
              {
                listId: list.listId,
                uri: path,
                originalUri: path,
                providerKey,
                token,
              },
              tx,
            )
          }
        })
      })

      // Add a small delay between batches to reduce database pressure
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    updateStatus({
      provider: providerKey,
      message: 'Collection complete!',
      phase: 'complete',
    })

    clearStatus()
  } catch (error: unknown) {
    if (error instanceof Error) {
      stop(`Error: ${error.message}`)
    } else {
      stop('An unknown error occurred')
    }
    throw error
  }
}
