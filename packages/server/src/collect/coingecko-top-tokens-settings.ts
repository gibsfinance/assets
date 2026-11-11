/**
 * @module collect/coingecko-top-tokens-settings
 *
 * Settings for the CoinGecko top-tokens collector, read once from the environment.
 * Pure: the caller passes the environment in, so tests never touch `process.env`.
 *
 * Source: https://docs.coingecko.com/reference/authentication (Pro key: host
 * `pro-api.coingecko.com`, header `x-cg-pro-api-key`) and
 * https://docs.coingecko.com/demo/reference/coins-markets (Demo key: host
 * `api.coingecko.com`, header `x-cg-demo-api-key`). With no key the public host answers
 * with an address-based limit shared by everyone behind the same address.
 */

/** How the configured key is presented to CoinGecko. */
export type CoinGeckoPlan = 'keyless' | 'demo' | 'pro'

/** Everything the top-tokens collector reads from the environment. */
export type CoinGeckoTopTokensSettings = {
  plan: CoinGeckoPlan
  /** The API root, with no trailing slash. */
  baseUrl: string
  /** Request headers that carry the key. Empty without a key. */
  headers: Record<string, string>
  /** The shortest gap between two requests, so a run stays under the plan's per-minute limit. */
  minimumIntervalMs: number
  /** How many tokens each chain's list keeps. */
  tokensPerChain: number
  /** How many pages of 250 coins, ranked by market capitalisation, a run may read. */
  marketPageLimit: number
  /** Numeric Ethereum-Virtual-Machine chain ids that get a list. */
  chainIds: number[]
}

/** The page size CoinGecko allows at most for `/coins/markets`. */
export const MARKETS_PAGE_SIZE = 250

/**
 * The chains that get a list unless `COINGECKO_TOP_TOKENS_CHAINS` says otherwise: the
 * chains the retired Etherscan scraper covered, plus PulseChain.
 */
export const DEFAULT_TOP_TOKEN_CHAIN_IDS: readonly number[] = [
  1, 10, 25, 56, 100, 137, 250, 288, 369, 1101, 1284, 1285, 2222, 5000, 8453, 42161, 42220, 43114, 59144, 81457, 534352,
]

/** Default tokens per chain. */
export const DEFAULT_TOKENS_PER_CHAIN = 100

/**
 * Default pages of market data. Sixteen pages is the 4,000 largest coins, enough to reach
 * a hundred tokens on the large chains; a chain with fewer in that range gets a shorter list.
 */
export const DEFAULT_MARKET_PAGE_LIMIT = 16

/** Spacing per plan, in milliseconds. Demo allows 100 calls a minute; keyless allows 5 to 15. */
const INTERVAL_MS_BY_PLAN: Record<CoinGeckoPlan, number> = { keyless: 12_000, demo: 700, pro: 150 }

const BASE_URL_BY_PLAN: Record<CoinGeckoPlan, string> = {
  keyless: 'https://api.coingecko.com/api/v3',
  demo: 'https://api.coingecko.com/api/v3',
  pro: 'https://pro-api.coingecko.com/api/v3',
}

const KEY_HEADER_BY_PLAN: Record<CoinGeckoPlan, string | null> = {
  keyless: null,
  demo: 'x-cg-demo-api-key',
  pro: 'x-cg-pro-api-key',
}

/** A whole number of at least one, or the fallback. */
export const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback
}

/** A comma-separated list of chain ids. Entries that are not whole numbers of at least one are dropped. */
export const parseChainIds = (value: string | undefined): number[] => {
  if (!value) return [...DEFAULT_TOP_TOKEN_CHAIN_IDS]
  const ids = value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((id) => Number.isInteger(id) && id >= 1)
  return ids.length > 0 ? [...new Set(ids)] : [...DEFAULT_TOP_TOKEN_CHAIN_IDS]
}

/**
 * Work out which plan a key belongs to. A key with no stated plan is a Pro key, which is how
 * the full CoinGecko collector has always treated `COINGECKO_API_KEY`.
 */
export const resolvePlan = (env: NodeJS.ProcessEnv): CoinGeckoPlan => {
  if (!env.COINGECKO_API_KEY) return 'keyless'
  return env.COINGECKO_API_PLAN?.toLowerCase() === 'demo' ? 'demo' : 'pro'
}

/**
 * Read the collector's settings.
 *
 * - `COINGECKO_API_KEY`: the key. Without it the public host is used, slowly.
 * - `COINGECKO_API_PLAN`: `demo` for a free Demo key; anything else is a Pro key.
 * - `COINGECKO_TOP_TOKENS_COUNT`: tokens per chain (default 100).
 * - `COINGECKO_TOP_TOKENS_CHAINS`: comma-separated chain ids (default: see `DEFAULT_TOP_TOKEN_CHAIN_IDS`).
 * - `COINGECKO_TOP_TOKENS_MARKET_PAGES`: most pages of 250 coins to read (default 16).
 * - `COINGECKO_TOP_TOKENS_INTERVAL_MS`: gap between requests, to override the plan's default.
 */
export const readCoinGeckoTopTokensSettings = (env: NodeJS.ProcessEnv): CoinGeckoTopTokensSettings => {
  const plan = resolvePlan(env)
  const keyHeader = KEY_HEADER_BY_PLAN[plan]
  return {
    plan,
    baseUrl: BASE_URL_BY_PLAN[plan],
    headers: keyHeader ? { [keyHeader]: env.COINGECKO_API_KEY! } : {},
    minimumIntervalMs: parsePositiveInteger(env.COINGECKO_TOP_TOKENS_INTERVAL_MS, INTERVAL_MS_BY_PLAN[plan]),
    tokensPerChain: parsePositiveInteger(env.COINGECKO_TOP_TOKENS_COUNT, DEFAULT_TOKENS_PER_CHAIN),
    marketPageLimit: parsePositiveInteger(env.COINGECKO_TOP_TOKENS_MARKET_PAGES, DEFAULT_MARKET_PAGE_LIMIT),
    chainIds: parseChainIds(env.COINGECKO_TOP_TOKENS_CHAINS),
  }
}
