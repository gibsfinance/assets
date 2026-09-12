/**
 * @module lifi-parse
 * Reading LiFi's token catalogue.
 *
 * `GET https://li.quest/v1/tokens` answers with `{ tokens: { "<chainId>": [...] } }`
 * and needs no key. It is large: 71 chains and 17,495 tokens, of which 10,750
 * are verified, 3,166 unverified and 3,579 flagged.
 *
 * Only the verified ones are collected. `flagged` is LiFi saying a token looks
 * malicious, and this service's whole output is artwork - lending a scam token
 * a clean logo is the one thing an image host must not do. `unverified` is left
 * out too, on the narrower ground that nothing has vouched for it and the
 * curated collectors already cover the tokens people actually hold.
 */
import { readToken, countRejection, asRecord, type AggregatorToken, type ParsedCatalogue } from './aggregator-parse'

/** The verification verdict a token must carry to be collected. */
export const REQUIRED_VERIFICATION_STATUS = 'verified'

/**
 * LiFi chain ids that are not Ethereum Virtual Machine chains.
 *
 * LiFi numbers Solana, Bitcoin and Sui with invented ids so they fit one field.
 * They are not chain ids in the sense anything else here means, and passing one
 * to the network insert would either be refused or create a fictitious
 * `eip155-1151111081099710` network. Two identifiers that merely differ are not
 * thereby related: mapping these onto real coin-type identifiers would mean
 * asserting a pairing on the strength of a number's shape, so they are skipped.
 * Solana is collected from Jupiter, which reports it as `solana-501`.
 */
export const NON_EVM_CHAIN_IDS: ReadonlySet<number> = new Set([
  1151111081099710, // Solana
  20000000000001, // Bitcoin
  9270000000000000, // Sui
])

/**
 * Read every verified token out of a LiFi tokens response.
 *
 * @param raw - The parsed response body. Any shape at all.
 */
export const parseLifiCatalogue = (raw: unknown): ParsedCatalogue => {
  const body = asRecord(raw)
  const byChain = body ? asRecord(body.tokens) : null
  if (!byChain) return { tokens: [], rejected: {} }

  const tokens: AggregatorToken[] = []
  const rejected: Record<string, number> = {}

  for (const entries of Object.values(byChain)) {
    if (!Array.isArray(entries)) {
      countRejection(rejected, 'chain entry was not a list')
      continue
    }
    for (const entry of entries) {
      const record = asRecord(entry)
      if (!record) {
        countRejection(rejected, 'not an object')
        continue
      }
      // Read the verdict before anything else. A token LiFi has flagged should
      // not even be measured against the other rules.
      if (record.verificationStatus !== REQUIRED_VERIFICATION_STATUS) {
        countRejection(rejected, `not ${REQUIRED_VERIFICATION_STATUS}`)
        continue
      }
      const read = readToken({
        chainId: record.chainId,
        address: record.address,
        name: record.name,
        symbol: record.symbol,
        decimals: record.decimals,
        logoURI: record.logoURI,
      })
      if ('reason' in read) {
        countRejection(rejected, read.reason)
        continue
      }
      if (NON_EVM_CHAIN_IDS.has(read.chainId)) {
        countRejection(rejected, 'not an Ethereum Virtual Machine chain')
        continue
      }
      tokens.push(read)
    }
  }

  return { tokens, rejected }
}
