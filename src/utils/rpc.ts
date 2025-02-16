import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

import { type PublicClient, createPublicClient, http, type Chain } from 'viem'
import debug from 'debug'

const dbg = debug('📷:rpc')

/**
 * @title RPC Client with Automatic Failover
 * @notice A robust RPC client implementation that handles multiple endpoints with automatic
 * failover, retry logic, and circuit breaking for failed endpoints.
 * @dev This client maintains a list of RPC URLs and automatically rotates between them
 * when failures occur. It includes exponential backoff for retries and tracks failed
 * endpoints to avoid using them until a reset occurs.
 */
export class RpcClient {
  private currentUrlIndex = 0
  private client: PublicClient | null = null
  private failedEndpoints = new Set<string>()

  /**
   * @notice Creates a new RPC client instance
   * @param urls Array of RPC endpoint URLs to use
   * @param chain The blockchain network configuration
   * @param maxRetries Maximum number of retry attempts per endpoint
   * @dev The client will try each URL up to maxRetries times before moving to the next URL
   */
  constructor(
    private urls: string[],
    private chain: Chain,
    private maxRetries = 3,
  ) {
    dbg(`Initializing RPC client for ${chain.name} with URLs:`)
    urls.forEach((url, i) => dbg(`  ${i + 1}. ${url}`))
    if (urls.length === 0) {
      throw new Error(`No RPC URLs provided for chain ${chain.name}`)
    }
    this.createClient()
  }

  /**
   * @notice Creates a new viem public client using the current endpoint
   * @dev Attempts to find a working endpoint that hasn't failed recently
   * If all endpoints have failed, it will reset the failed endpoints list and try again
   */
  private createClient() {
    // Try to find a working endpoint that hasn't failed
    let attempts = 0
    while (attempts < this.urls.length) {
      const url = this.urls[this.currentUrlIndex]
      if (!this.failedEndpoints.has(url)) {
        dbg(`Creating RPC client for ${this.chain.name} using ${url}`)
        this.client = createPublicClient({
          chain: this.chain,
          transport: http(url),
          batch: {
            multicall: {
              batchSize: 32,
              wait: 0,
            },
          },
        })
        return
      }
      this.currentUrlIndex = (this.currentUrlIndex + 1) % this.urls.length
      attempts++
    }

    // If all endpoints have failed, reset and try again
    if (this.failedEndpoints.size === this.urls.length) {
      dbg(`All endpoints failed for ${this.chain.name}, resetting failed endpoints list`)
      this.failedEndpoints.clear()
      this.currentUrlIndex = 0
      this.createClient()
    }
  }

  /**
   * @notice Rotates to the next available RPC endpoint
   * @param failedUrl The URL that failed and triggered the rotation
   * @dev Adds the failed URL to the failedEndpoints set and attempts to find the next
   * working endpoint. If all endpoints have failed, this will be handled by createClient
   */
  private rotateEndpoint(failedUrl: string) {
    this.failedEndpoints.add(failedUrl)
    const oldUrl = this.urls[this.currentUrlIndex]

    // Try to find next working endpoint
    let attempts = 0
    do {
      this.currentUrlIndex = (this.currentUrlIndex + 1) % this.urls.length
      attempts++
    } while (this.failedEndpoints.has(this.urls[this.currentUrlIndex]) && attempts < this.urls.length)

    const newUrl = this.urls[this.currentUrlIndex]
    dbg(`[${this.chain.name}] Rotating RPC endpoint:`)
    dbg(`  From: ${oldUrl}`)
    dbg(`  To:   ${newUrl}`)
    dbg(`  Index: ${this.currentUrlIndex + 1}/${this.urls.length}`)
    dbg(`  Failed endpoints: ${Array.from(this.failedEndpoints).join(', ')}`)

    this.createClient()
  }

  /**
   * @notice Executes an operation with automatic retries and failover
   * @param operation The async operation to perform with the RPC client
   * @returns The result of the operation
   * @dev Implements exponential backoff for retries and will try all available endpoints
   * before giving up. The total number of attempts will be maxRetries * number of URLs
   * @throws Error if all attempts fail across all endpoints
   */
  async withRetry<T>(operation: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: Error | null = null
    let retryCount = 0
    const maxAttempts = this.maxRetries * this.urls.length

    while (retryCount < maxAttempts) {
      try {
        if (!this.client) throw new Error('No RPC client available')
        const currentUrl = this.urls[this.currentUrlIndex]
        dbg(`[${this.chain.name}] Attempting operation using ${currentUrl} (attempt ${retryCount + 1}/${maxAttempts})`)
        return await operation(this.client)
      } catch (err) {
        lastError = err as Error
        const currentUrl = this.urls[this.currentUrlIndex]

        // Log the full error details
        dbg(`[${this.chain.name}] Error on ${currentUrl} (attempt ${retryCount + 1}/${maxAttempts}):`)
        dbg(`  Message: ${lastError.message}`)
        dbg(`  Details: ${JSON.stringify(err)}`)

        // Mark current endpoint as failed and rotate
        this.rotateEndpoint(currentUrl)
        retryCount++

        // Add a delay before retrying
        const delay = Math.min(2000 * Math.pow(2, retryCount - 1), 10000)
        dbg(`[${this.chain.name}] Waiting ${delay}ms before next attempt...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new Error(
      `All RPC attempts failed for ${this.chain.name} after ${retryCount} tries. Last error: ${lastError?.message}`,
    )
  }

  /**
   * @notice Gets the current chain ID from the RPC endpoint
   * @returns The chain ID as a number
   * @dev Uses the withRetry mechanism to handle failures
   */
  async getChainId(): Promise<number> {
    return this.withRetry((client) => client.getChainId())
  }

  /**
   * @notice Fetches logs from the blockchain with enhanced error handling
   * @param args The log filter parameters
   * @returns Array of log entries
   * @dev Implements a specialized retry mechanism for log fetching with detailed error logging
   * Uses exponential backoff and will try all available endpoints before failing
   * @throws Error if all attempts fail across all endpoints
   */
  async getLogs(args: Parameters<PublicClient['getLogs']>[0]) {
    let lastError: Error | null = null
    let retryCount = 0
    const maxAttempts = this.maxRetries * this.urls.length

    while (retryCount < maxAttempts) {
      try {
        if (!this.client) throw new Error('No RPC client available')
        const currentUrl = this.urls[this.currentUrlIndex]
        dbg(`[${this.chain.name}] Attempting getLogs using ${currentUrl} (attempt ${retryCount + 1}/${maxAttempts})`)

        const result = await this.client.getLogs(args)
        dbg(`[${this.chain.name}] getLogs succeeded using ${currentUrl}`)
        return result
      } catch (err) {
        lastError = err as Error
        const currentUrl = this.urls[this.currentUrlIndex]

        // Log the full error details
        dbg(`[${this.chain.name}] getLogs error on ${currentUrl} (attempt ${retryCount + 1}/${maxAttempts}):`)
        dbg(`  Message: ${lastError.message}`)
        dbg(`  Details: ${JSON.stringify(err)}`)

        // Mark current endpoint as failed and rotate
        this.rotateEndpoint(currentUrl)
        retryCount++

        // Add a delay before retrying
        const delay = Math.min(2000 * Math.pow(2, retryCount - 1), 10000)
        dbg(`[${this.chain.name}] Waiting ${delay}ms before next attempt...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new Error(
      `All getLogs attempts failed for ${this.chain.name} after ${retryCount} tries. Last error: ${lastError?.message}`,
    )
  }

  // Add more methods as needed...
}
