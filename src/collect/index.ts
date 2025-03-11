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

const dbg = debug('📷:collect')

/**
 * @notice Configuration constants for collection tuning
 * @dev Changes:
 * 1. Added maximum retry attempts per provider
 * 2. Reduced concurrency from 4 to 2 for better stability
 */
const MAX_PROVIDER_RETRIES = 2
const PROVIDER_CONCURRENCY = 2

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
  try {
    updateStatus({
      provider,
      message: 'Collecting data...',
      current: index + 1,
      total,
      phase: 'processing',
    } satisfies StatusProps)

    await collector()

    updateStatus({
      provider,
      message: 'Collection complete',
      current: index + 1,
      total,
      phase: 'complete',
    } satisfies StatusProps)
  } catch (err) {
    if (retryCount < MAX_PROVIDER_RETRIES) {
      const delay = Math.pow(2, retryCount) * 2000
      updateStatus({
        provider,
        message: `Retrying in ${delay / 1000}s...`,
        current: index + 1,
        total,
        phase: 'setup',
      } satisfies StatusProps)
      await new Promise((resolve) => setTimeout(resolve, delay))
      return collectWithRetry(collector, provider, index, total, retryCount + 1)
    }
    throw err
  }
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
              provider,
              message: 'Skipped - No collector found',
              current: index + 1,
              total: providers.length,
              phase: 'complete',
            } satisfies StatusProps)
            return
          }

          await collectWithRetry(collector, provider, index, providers.length)
          results.successful.push(provider)
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          updateStatus({
            provider,
            message: `Failed: ${errorMessage}`,
            current: index + 1,
            total: providers.length,
            phase: 'complete',
          } satisfies StatusProps)
          dbg(`Error collecting from ${provider}: ${errorMessage}`)
          results.failed.push({ provider, error: errorMessage })
        }
      }),
    ),
  )

  // Print final summary
  updateStatus({
    provider: 'summary',
    message: `Collection complete - Success: ${results.successful.length}, Failed: ${results.failed.length}, Skipped: ${results.skipped.length}`,
    phase: 'complete',
  } satisfies StatusProps)

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
