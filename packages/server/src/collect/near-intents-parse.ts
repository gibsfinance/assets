/**
 * @module near-intents-parse
 * Reading the asset list NEAR Intents will settle.
 *
 * `GET https://1click.chaindefuser.com/v0/tokens` answers with a flat array and
 * needs no key. It is small and deliberate — 188 assets across 35 chains — which
 * is the opposite of LiFi and Relay: not everything routable, but the set NEAR
 * Intents has solvers for.
 *
 * Two things it does not carry, and neither is worked around here:
 *
 * It has **no artwork**. Every asset comes back with a symbol, decimals, a price
 * and a `coingeckoId`, and no logo. Resolving one through the CoinGecko
 * identifier would mean treating two identifiers as a pair because they sit in
 * the same record, which is the reasoning that puts the wrong token's picture on
 * a screen. So this collector contributes list membership and metadata, not
 * images — where a token is already known from another provider, that provider's
 * artwork answers for it, and where it is not, it has none.
 *
 * It has **no names**, only symbols. `readToken` falls back to the symbol, which
 * is stated there rather than left for a reader to infer from a blank column.
 */
import { readToken, countRejection, asRecord, type AggregatorToken, type ParsedCatalogue } from './aggregator-parse'

/**
 * NEAR Intents chain codes mapped to Ethereum Virtual Machine chain ids.
 *
 * Every entry was checked against the chain registry at chainid.network on
 * 2026-09-08 rather than recalled, and the registry's own name is quoted beside
 * it so the next reader can check the same way. A chain code is not evidence of
 * a chain id: "pol" resolving to Polygon rather than to Polygon zkEVM is a fact
 * to look up, not to infer.
 *
 * Codes absent from this map are skipped and counted, not guessed. That covers
 * every chain that is not an Ethereum Virtual Machine chain — near, sol, aptos,
 * starknet, sui, btc, tron, ton, stellar, and the rest — which belong under
 * their own coin-type identifiers and are collected, where they are collected at
 * all, by the sources that speak those chains natively.
 */
export const CHAIN_ID_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  eth: 1, // Ethereum Mainnet
  op: 10, // OP Mainnet
  bsc: 56, // BNB Smart Chain Mainnet
  gnosis: 100, // Gnosis
  pol: 137, // Polygon Mainnet
  monad: 143, // Monad
  xlayer: 196, // X Layer Mainnet
  abs: 2741, // Abstract
  base: 8453, // Base
  plasma: 9745, // Plasma Mainnet
  avax: 43114, // Avalanche C-Chain
  arb: 42161, // Arbitrum One
  bera: 80094, // Berachain
  scroll: 534352, // Scroll
})

/**
 * Read every asset that sits on a mapped chain and carries a contract address.
 *
 * An asset with no `contractAddress` is the chain's native coin. It is skipped
 * rather than filed under the all-zero address: that convention is LiFi's and
 * this service's, not NEAR Intents', and adopting it here would be this module
 * asserting an identity its source never stated.
 *
 * @param raw - The parsed response body. Any shape at all.
 */
export const parseNearIntentsCatalogue = (raw: unknown): ParsedCatalogue => {
  if (!Array.isArray(raw)) return { tokens: [], rejected: {} }

  const tokens: AggregatorToken[] = []
  const rejected: Record<string, number> = {}

  for (const entry of raw) {
    const record = asRecord(entry)
    if (!record) {
      countRejection(rejected, 'not an object')
      continue
    }
    const code = typeof record.blockchain === 'string' ? record.blockchain : ''
    const chainId = CHAIN_ID_BY_CODE[code]
    if (chainId === undefined) {
      countRejection(rejected, 'chain not mapped to an Ethereum Virtual Machine id')
      continue
    }
    if (record.contractAddress === undefined || record.contractAddress === null) {
      countRejection(rejected, 'native coin, no contract address')
      continue
    }
    const read = readToken({
      chainId,
      address: record.contractAddress,
      // The feed carries no name. readToken falls back to the symbol.
      name: undefined,
      symbol: record.symbol,
      decimals: record.decimals,
      logoURI: null,
    })
    if ('reason' in read) {
      countRejection(rejected, read.reason)
      continue
    }
    tokens.push(read)
  }

  return { tokens, rejected }
}
