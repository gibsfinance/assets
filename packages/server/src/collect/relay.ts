/**
 * @module relay
 * Relay's routable currency catalogue.
 *
 * Relay is a cross-chain execution layer. Like LiFi it publishes everything it
 * will route rather than a curated list, and it reports both a verification
 * flag and a virtual machine type per token. `relay-parse` explains what is
 * kept and why.
 *
 * The request is a POST with no key. `offset` is accepted and ignored, so there
 * is no paging to do: one request with a generous limit returns the whole
 * verified set — about seven thousand tokens — and asking for more returns the
 * same thing. That is why `CATALOGUE_LIMIT` is far above the real count rather
 * than tuned to it; it is a ceiling, not a page size.
 */
import { fetch } from '../fetch'
import { AggregatorCollector } from './aggregator'
import { parseRelayCatalogue } from './relay-parse'
import type { ParsedCatalogue } from './aggregator-parse'

const providerKey = 'relay'
const providerName = 'Relay'

/** Relay's currency search. */
export const CURRENCIES_URL = 'https://api.relay.link/currencies/v1'

/**
 * Ceiling on how much of the catalogue to ask for.
 *
 * Set well above the roughly seven thousand tokens Relay actually returns, so
 * the request keeps fetching everything as the catalogue grows instead of
 * silently truncating on the day it passes a tuned number.
 */
export const CATALOGUE_LIMIT = 50_000

/** Fetch and narrow the catalogue. Exported so a test can drive it directly. */
export const fetchCatalogue = async (signal: AbortSignal): Promise<ParsedCatalogue> => {
  const response = await fetch(CURRENCIES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // `verified` is asked for at the source as well as checked in the parser.
    // Asking narrows six thousand irrelevant rows off the wire; checking is
    // what holds if the parameter is ever renamed or quietly dropped.
    body: JSON.stringify({ verified: true, limit: CATALOGUE_LIMIT }),
    signal,
  })
  const raw = (await response.json()) as unknown
  return parseRelayCatalogue(raw)
}

const instance = new AggregatorCollector({ providerKey, providerName, fetchCatalogue })
export default instance

/** Standalone entry point running both phases, as the other collectors expose. */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
