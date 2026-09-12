/**
 * @module relay-parse
 * Reading Relay's currency catalogue.
 *
 * `POST https://api.relay.link/currencies/v1` answers with an array of groups,
 * each group holding the same currency on one or more chains. It needs no key.
 * Asking for `verified: true` with a generous `limit` returns the whole set in
 * one request - 6,981 tokens over 114 chains - and saturates there, so nothing
 * pages. `offset` is accepted and ignored, which is worth knowing before anyone
 * writes a paging loop against it.
 *
 * Two filters matter and both come from Relay itself rather than from a guess
 * here. `metadata.verified` separates real tokens from entries like
 * "Infinite Monkey: POAYFPKWSKCHB", which the unfiltered feed returns beside
 * Tether. `vmType` separates Ethereum Virtual Machine chains from the rest -
 * Relay numbers Solana, Tron, Bitcoin and TON with ids that look like chain ids
 * and are not. Tron's 728126428 is one the database already refuses by name,
 * which is the shape of mistake this filter avoids making in the first place.
 */
import { readToken, countRejection, asRecord, type AggregatorToken, type ParsedCatalogue } from './aggregator-parse'

/** The only virtual machine whose chain ids mean what this service means by one. */
export const REQUIRED_VM_TYPE = 'evm'

/**
 * Read every verified Ethereum Virtual Machine token out of a Relay response.
 *
 * @param raw - The parsed response body: an array of groups of tokens.
 */
export const parseRelayCatalogue = (raw: unknown): ParsedCatalogue => {
  if (!Array.isArray(raw)) return { tokens: [], rejected: {} }

  const tokens: AggregatorToken[] = []
  const rejected: Record<string, number> = {}

  for (const group of raw) {
    // A group is the same currency across chains. A response that is a flat
    // list of tokens rather than a list of groups still reads correctly.
    const entries = Array.isArray(group) ? group : [group]
    for (const entry of entries) {
      const record = asRecord(entry)
      if (!record) {
        countRejection(rejected, 'not an object')
        continue
      }
      if (record.vmType !== REQUIRED_VM_TYPE) {
        countRejection(rejected, 'not an Ethereum Virtual Machine chain')
        continue
      }
      const metadata = asRecord(record.metadata)
      // Absent metadata is not the same as `verified: false`, but it is not a
      // vouch either, and only a vouch is enough to publish artwork for.
      if (metadata?.verified !== true) {
        countRejection(rejected, 'not verified')
        continue
      }
      const read = readToken({
        chainId: record.chainId,
        address: record.address,
        name: record.name,
        symbol: record.symbol,
        decimals: record.decimals,
        logoURI: metadata.logoURI,
      })
      if ('reason' in read) {
        countRejection(rejected, read.reason)
        continue
      }
      tokens.push(read)
    }
  }

  return { tokens, rejected }
}
