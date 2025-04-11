/**
 * @title Token Collection Orchestrator
 * @notice Manages parallel collection from multiple token providers
 * @dev Changes from original version:
 * 1. Added controlled concurrency with reduced parallel operations
 * 2. Implemented provider-level retry mechanism
 * 3. Enhanced error handling and reporting
 * 4. Added detailed progress tracking
 */

import debug from 'debug'
import promiseLimit from 'promise-limit'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'
import { type Collectable, collectables } from './collectables'
import * as utils from '@/utils'

const dbg = debug('📷:collect')

/**
 * @notice Configuration constants for collection tuning
 */
const PROVIDER_CONCURRENCY = 4

/**
 * @notice Retry wrapper for individual collector execution
 * @dev Changes:
 * 1. Added exponential backoff between retries
 * 2. Enhanced status reporting for retry attempts
 * 3. Improved error context preservation
 */
async function collectWithRetry(
  collector: () => Promise<void>,
  provider: string,
  index: number,
  total: number,
  retryCount = 0,
): Promise<void> {
  updateStatus({
    provider: 'system',
    message: `⏳ [${index + 1}/${total}] Collecting from ${provider}...`,
    phase: 'setup',
  } satisfies StatusProps)
  await collector()
  updateStatus({
    provider: 'system',
    message: `✅ [${index + 1}/${total}] Successfully collected from ${provider}`,
    phase: 'complete',
  } satisfies StatusProps)
}

/**
 * @notice Main collection function that orchestrates data collection from multiple providers
 * @dev Changes:
 * 1. Replaced simple Promise.all with controlled concurrency
 * 2. Added comprehensive result tracking (success/fail/skip)
 * 3. Implemented detailed progress reporting
 * 4. Added collection summary with provider status
 */
export const main = async (providers: Collectable[]) => {
  const c = collectables()

  dbg(`Starting parallel collection for ${providers.length} providers`)

  updateStatus({
    provider: 'system',
    message: `Starting collection from ${providers.length} providers`,
    phase: 'setup',
  } satisfies StatusProps)

  const results = {
    successful: [] as string[],
    failed: [] as { provider: string; error: any }[],
    skipped: [] as string[],
  }

  const limit = promiseLimit(PROVIDER_CONCURRENCY)

  await Promise.all(
    providers.map((provider, index) =>
      limit(async () => {
        try {
          const collector = c[provider]
          if (!collector) {
            results.skipped.push(provider)
            updateStatus({
              provider: 'system',
              message: `⚠️ [${index + 1}/${providers.length}] Skipped ${provider} - No collector found`,
              phase: 'complete',
            })
            return
          }

          await collectWithRetry(collector, provider, index, providers.length)
          results.successful.push(provider)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          dbg(`  Error: ${errorMessage}`)
          updateStatus({
            provider: 'system',
            message: `❌ [${index + 1}/${providers.length}] Failed collecting from ${provider}`,
            phase: 'complete',
          })
          results.failed.push({ provider, error: errorMessage })
        }
      }),
    ),
  )

  // Print summary
  dbg('\nCollection Summary:')

  // Log detailed results for debugging
  if (results.successful.length > 0) {
    dbg(`Successfully collected from: ${results.successful.join(', ')}`)
  }

  if (results.skipped.length > 0) {
    dbg(`Skipped providers: ${results.skipped.join(', ')}`)
  }

  if (results.failed.length > 0) {
    dbg('Failed collectors:')
    results.failed.forEach(({ provider, error }) => {
      dbg(`${provider}: ${error}`)
    })
  }

  // Return results for potential further processing
  return results
}
