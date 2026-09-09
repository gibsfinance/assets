/**
 * @module lifi
 * LiFi's routable token catalogue.
 *
 * LiFi is a bridge and swap aggregator. Its catalogue is not a curated list —
 * it is everything LiFi will route — so it reaches chains and tokens the
 * curated collectors do not, and it carries a verification verdict this
 * service has to respect rather than ignore. `lifi-parse` explains what is
 * kept and why.
 *
 * The whole catalogue is one unauthenticated request of about six megabytes,
 * so it goes through `cachedJSONRequest` like every other remote list.
 */
import * as db from '../db'
import { AggregatorCollector } from './aggregator'
import { parseLifiCatalogue } from './lifi-parse'
import type { ParsedCatalogue } from './aggregator-parse'

const providerKey = 'lifi'
const providerName = 'LI.FI'

/** Every token LiFi will route, on every chain it supports. */
export const TOKENS_URL = 'https://li.quest/v1/tokens'

/** Fetch and narrow the catalogue. Exported so a test can drive it directly. */
export const fetchCatalogue = async (signal: AbortSignal): Promise<ParsedCatalogue> => {
  const raw = await db.cachedJSONRequest<Record<string, unknown>>(TOKENS_URL, signal, TOKENS_URL)
  return parseLifiCatalogue(raw)
}

const instance = new AggregatorCollector({ providerKey, providerName, fetchCatalogue })
export default instance

/** Standalone entry point running both phases, as the other collectors expose. */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
