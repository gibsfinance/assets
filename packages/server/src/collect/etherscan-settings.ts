/**
 * @module collect/etherscan-settings
 *
 * Reads the Etherscan collector's settings from environment text. A pure function of the
 * environment, so `config.ts` calls it once at start-up and tests call it with a plain object.
 *
 * | Variable | Default | Meaning |
 * |---|---|---|
 * | `ETHERSCAN_API_KEY` | unset | The key. A secret: environment only, never printed. Unset turns the collector off. |
 * | `ETHERSCAN_CALLS_PER_SECOND` | 3 | Your plan's calls per second (free 3, Lite 5, Standard 10, Advanced 20, Professional 30). |
 * | `ETHERSCAN_TOKENS_PER_CHAIN` | 100 | Most tokens fetched for one chain in one run. |
 * | `ETHERSCAN_SOURCE_LISTS` | `coingecko:top-tokens,routescan:top-tokens` | Which lists, from other providers, name the tokens to fetch. |
 * | `ETHERSCAN_CHAIN_IDS` | every chain the collector knows | Comma separated chain ids to restrict the run to. |
 *
 * Plan limits: https://docs.etherscan.io/resources/rate-limits
 */
import { readLimit } from '../runtime/read-limit'

/** The provider this collector files its lists under. */
export const ETHERSCAN_PROVIDER_KEY = 'etherscan'

/** One source of token addresses: lists of one provider whose key starts with a prefix. */
export type EtherscanSourceList = {
  providerKey: string
  /** An empty prefix matches every list the provider has on the chain. */
  listKeyPrefix: string
}

/** Everything the collector, the probe and the command read from the environment. */
export type EtherscanSettings = {
  /** The API key, or undefined when none is set. Treat as a secret. */
  apiKey: string | undefined
  callsPerSecond: number
  tokensPerChain: number
  sourceLists: EtherscanSourceList[]
  /** The chain ids to restrict the run to, or null for every known chain. */
  chainIds: number[] | null
}

const DEFAULT_CALLS_PER_SECOND = 3
const DEFAULT_TOKENS_PER_CHAIN = 100
const DEFAULT_SOURCE_LISTS = 'coingecko:top-tokens,routescan:top-tokens'

/** Split comma separated text into trimmed, non-empty entries. */
const splitEntries = (text: string): string[] =>
  text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')

/**
 * Parse `provider` or `provider:keyPrefix` entries. The Etherscan provider itself is refused as a
 * source: a list built from its own lists would feed on itself.
 */
export const parseSourceLists = (text: string): EtherscanSourceList[] =>
  splitEntries(text)
    .map((entry) => {
      const [providerKey, ...prefixParts] = entry.split(':')
      return { providerKey: providerKey.trim(), listKeyPrefix: prefixParts.join(':').trim() }
    })
    .filter(({ providerKey }) => providerKey !== '' && providerKey !== ETHERSCAN_PROVIDER_KEY)

/** Parse comma separated chain ids. Entries that are not whole positive numbers are dropped. */
export const parseChainIds = (text: string): number[] =>
  splitEntries(text)
    .map(Number)
    .filter((chainId) => Number.isInteger(chainId) && chainId >= 1)

/**
 * Read the settings from environment text.
 *
 * A limit that is not a whole number of at least one falls back to its default (see `readLimit`).
 * A source list or chain list that yields no usable entry falls back to its default too, so a typo
 * never silently turns the collector into a no-op that looks configured.
 *
 * @param environment The process environment, or a stand-in.
 */
export const readEtherscanSettings = (environment: Record<string, string | undefined>): EtherscanSettings => {
  const apiKey = environment.ETHERSCAN_API_KEY?.trim() || undefined
  const sourceLists = parseSourceLists(environment.ETHERSCAN_SOURCE_LISTS ?? '')
  const chainIds = parseChainIds(environment.ETHERSCAN_CHAIN_IDS ?? '')
  return {
    apiKey,
    callsPerSecond: readLimit(environment.ETHERSCAN_CALLS_PER_SECOND, DEFAULT_CALLS_PER_SECOND),
    tokensPerChain: readLimit(environment.ETHERSCAN_TOKENS_PER_CHAIN, DEFAULT_TOKENS_PER_CHAIN),
    sourceLists: sourceLists.length > 0 ? sourceLists : parseSourceLists(DEFAULT_SOURCE_LISTS),
    chainIds: chainIds.length > 0 ? chainIds : null,
  }
}
