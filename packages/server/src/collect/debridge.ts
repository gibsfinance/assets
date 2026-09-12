/**
 * @module debridge
 * deBridge's routable token catalogue.
 *
 * A fourth source on the shared aggregator shape, and the broadest of them by
 * novel artwork: across the seven largest chains it carries 15,222 tokens with
 * logos, and 4,139 of those — 27% — are for tokens no other provider here
 * covers. Every logo is on deBridge's own store rather than mirrored from
 * somewhere already ranked above, which is what separates it from Relay.
 *
 * It takes two requests per run rather than one: the chain list, then one token
 * list per chain. `debridge-parse` explains why the chain list has to be read
 * first and why its two number fields are not interchangeable.
 */
import { failureLog } from '@gibs/utils'
import * as db from '../db'
import { AggregatorCollector } from './aggregator'
import { parseChainList, parseChainTokens } from './debridge-parse'
import { countRejection, type AggregatorToken, type ParsedCatalogue } from './aggregator-parse'

const providerKey = 'debridge'
const providerName = 'deBridge'

/** The chains deBridge settles, and the numbers its token endpoint answers to. */
export const CHAINS_URL = 'https://dln.debridge.finance/v1.0/supported-chains-info'

/** One chain's tokens. Keyed by deBridge's own chain number, not by the chain id. */
export const tokenListUrl = (requestId: number): string =>
  `https://dln.debridge.finance/v1.0/token-list?chainId=${requestId}`

/**
 * Fetch the chain list, then every chain's tokens, and narrow the lot.
 *
 * A chain whose token list fails is counted and skipped. Seventeen requests
 * where one can fail is a different risk from one request that either works or
 * does not: losing sixteen chains because the seventeenth timed out would be
 * the collector punishing itself for deBridge having more chains.
 */
export const fetchCatalogue = async (signal: AbortSignal): Promise<ParsedCatalogue> => {
  const chainsRaw = await db.cachedJSONRequest<Record<string, unknown>>(CHAINS_URL, signal, CHAINS_URL)
  const chains = parseChainList(chainsRaw)
  if (chains.length === 0) return { tokens: [], rejected: { 'chain list unreadable': 1 } }

  const tokens: AggregatorToken[] = []
  const rejected: Record<string, number> = {}

  for (const chain of chains) {
    if (signal.aborted) break
    const url = tokenListUrl(chain.requestId)
    const raw = await db.cachedJSONRequest<Record<string, unknown>>(url, signal, url).catch((err: unknown) => {
      failureLog('provider=%o chain=%o token list failed: %o', providerKey, chain.name, (err as Error).message)
      return null
    })
    if (!raw) {
      countRejection(rejected, 'chain token list unavailable')
      continue
    }
    const read = parseChainTokens(raw, chain.chainId)
    tokens.push(...read.tokens)
    for (const [reason, count] of Object.entries(read.rejected)) {
      rejected[reason] = (rejected[reason] ?? 0) + count
    }
  }

  return { tokens, rejected }
}

const instance = new AggregatorCollector({ providerKey, providerName, fetchCatalogue })
export default instance

/** Standalone entry point running both phases, as the other collectors expose. */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
