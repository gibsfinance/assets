/**
 * @module near-intents
 * The assets NEAR Intents will settle.
 *
 * A third aggregator on the same shape as LiFi and Relay, and the one that shows
 * what the shape is worth: its response looks nothing like theirs, and once
 * `near-intents-parse` has narrowed it the collector is three lines of
 * configuration.
 *
 * It contributes list membership and metadata rather than artwork — the feed
 * carries no logos at all. See `near-intents-parse` for why resolving them
 * through the CoinGecko identifier it does carry is refused.
 */
import * as db from '../db'
import { AggregatorCollector } from './aggregator'
import { parseNearIntentsCatalogue } from './near-intents-parse'
import type { ParsedCatalogue } from './aggregator-parse'

const providerKey = 'near-intents'
const providerName = 'NEAR Intents'

/** Every asset NEAR Intents has solvers for. */
export const TOKENS_URL = 'https://1click.chaindefuser.com/v0/tokens'

/** Fetch and narrow the catalogue. Exported so a test can drive it directly. */
export const fetchCatalogue = async (signal: AbortSignal): Promise<ParsedCatalogue> => {
  const raw = await db.cachedJSONRequest<unknown[]>(TOKENS_URL, signal, TOKENS_URL)
  return parseNearIntentsCatalogue(raw)
}

const instance = new AggregatorCollector({ providerKey, providerName, fetchCatalogue })
export default instance

/** Standalone entry point running both phases, as the other collectors expose. */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
