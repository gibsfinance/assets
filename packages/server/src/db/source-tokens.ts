/**
 * @module db/source-tokens
 *
 * Reads which tokens other providers rank first, for collectors that fetch richer data for
 * tokens somebody else has already found. The Etherscan collector uses it: Etherscan has no
 * endpoint that ranks tokens, so it asks the lists in this database.
 */
import { sql as dsql } from 'drizzle-orm'
import { getDrizzle } from './drizzle'
import * as s from './schema'

/** One place to read token addresses from: lists of one provider whose key starts with a prefix. */
export type SourceListSelector = {
  providerKey: string
  /** An empty prefix matches every list the provider has on the network. */
  listKeyPrefix: string
}

/**
 * The addresses of the tokens other providers rank first on one network.
 *
 * For each selector, in the order given, this reads the newest published version of every
 * matching list on the network and takes its tokens by position in the list (best first, the
 * position the source collector stored). A token that several lists or selectors name keeps its
 * earliest place. Superseded and unpublished versions are ignored, so a half-written list never
 * decides what another provider fetches.
 *
 * @param options.networkId The network row id, for example `eip155-1`.
 * @param options.sources Where to read from, highest priority first.
 * @param options.limit The most addresses to return.
 * @returns Distinct addresses as stored (lower case for Ethereum Virtual Machine chains).
 */
export const getTopTokenAddresses = async ({
  networkId,
  sources,
  limit,
}: {
  networkId: string
  sources: readonly SourceListSelector[]
  limit: number
}): Promise<string[]> => {
  const db = getDrizzle()
  const addresses = new Set<string>()
  for (const { providerKey, listKeyPrefix } of sources) {
    const rows = await db.execute<{ providedId: string }>(dsql`
      SELECT source_token.provided_id AS "providedId"
      FROM ${s.listToken} source_entry
      INNER JOIN ${s.list} source_list ON source_list.list_id = source_entry.list_id
      INNER JOIN ${s.provider} source_provider ON source_provider.provider_id = source_list.provider_id
      INNER JOIN ${s.token} source_token ON source_token.token_id = source_entry.token_id
      WHERE source_provider.key = ${providerKey}
        AND source_list.network_id = ${networkId}
        AND source_token.network_id = ${networkId}
        AND starts_with(source_list.key, ${listKeyPrefix})
        AND source_list.tokens_collected_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${s.list} newer
          WHERE newer.provider_id = source_list.provider_id
            AND newer.key = source_list.key
            AND (newer.major, newer.minor, newer.patch)
              > (source_list.major, source_list.minor, source_list.patch)
            AND newer.tokens_collected_at IS NOT NULL
        )
      GROUP BY source_token.provided_id
      ORDER BY MIN(source_entry.list_token_order_id), source_token.provided_id
      LIMIT ${limit}
    `)
    for (const { providedId } of rows.rows) addresses.add(providedId)
  }
  return [...addresses].slice(0, limit)
}
