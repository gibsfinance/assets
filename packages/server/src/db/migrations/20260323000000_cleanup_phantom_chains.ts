import type { Knex } from 'knex'

/**
 * Clean up tokens and networks with incorrect chain IDs caused by
 * the TrustWallet collector's sterilize() collision bug.
 *
 * Chain 661898459 ("Smart Mainnet") was incorrectly assigned to BSC
 * tokens because sterilize("smartchain") → "smart" matched it instead
 * of BNB Smart Chain (56). The collector fix prevents future mismatches;
 * this migration removes the stale data so the next collection run
 * re-creates it under the correct chain IDs.
 *
 * Schema: network.chainId → token.networkId → list_token.tokenId
 */

const PHANTOM_CHAIN_IDS = [
  '661898459', // "Smart Mainnet" — was actually BSC (56)
]

export async function up(knex: Knex): Promise<void> {
  for (const chainId of PHANTOM_CHAIN_IDS) {
    // Find the networkId(s) for this phantom chain
    const networks = await knex('network').select('networkId').where('chainId', chainId)

    if (networks.length === 0) continue

    const networkIds = networks.map((n: { networkId: string }) => n.networkId)

    // Find all tokenIds on these networks
    const tokens = await knex('token').select('tokenId').whereIn('networkId', networkIds)

    const tokenIds = tokens.map((t: { tokenId: string }) => t.tokenId)

    if (tokenIds.length > 0) {
      // Delete list_token rows referencing these tokens
      await knex('list_token').whereIn('tokenId', tokenIds).del()

      // Delete the tokens
      await knex('token').whereIn('tokenId', tokenIds).del()
    }

    // Delete the phantom network(s)
    await knex('network').where('chainId', chainId).del()
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Data will be re-created by the next collector run
}
