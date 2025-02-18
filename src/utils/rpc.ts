import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

import debug from 'debug'
import { createPublicClient, fallback, http, type Chain, type PublicClient } from 'viem'

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
   * @dev Uses viem's fallback transport to handle failing endpoints automatically
   */
  private createClient() {
    dbg(`Creating RPC client for ${this.chain.name} using fallback transport`)
    this.client = createPublicClient({
      chain: this.chain,
      transport: fallback(
        this.urls.map((url) => http(url)),
        { rank: true },
      ),
      batch: {
        multicall: {
          batchSize: 32,
          wait: 0,
        },
      },
    })
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
   * @notice Executes an operation with the RPC client
   * @param operation The async operation to perform with the RPC client
   * @returns The result of the operation
   * @dev Exits immediately if the operation fails
   * @throws Error if the attempt fails
   */
  async withRetry<T>(operation: (client: PublicClient) => Promise<T>): Promise<T> {
    try {
      if (!this.client) throw new Error('No RPC client available')
      return await operation(this.client)
    } catch (err) {
      const error = err as Error
      dbg(`[${this.chain.name}] Operation failed:`)
      dbg(`  Message: ${error.message}`)
      dbg(`  Details: ${JSON.stringify(err)}`)
      throw error
    }
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
   * @notice Fetches logs from the blockchain
   * @param args The log filter parameters
   * @returns Array of log entries
   * @dev Exits immediately if the operation fails
   * @throws Error if the attempt fails
   */
  async getLogs(args: Parameters<PublicClient['getLogs']>[0]) {
    try {
      if (!this.client) throw new Error('No RPC client available')
      return await this.client.getLogs(args)
    } catch (err) {
      const error = err as Error
      dbg(`[${this.chain.name}] getLogs failed:`)
      dbg(`  Message: ${error.message}`)
      dbg(`  Details: ${JSON.stringify(err)}`)
      throw error
    }
  }

  // Add more methods as needed...
}
