/**
 * @module collect/coingecko-top-tokens-select
 *
 * Pure steps that turn CoinGecko's three feeds into one ranked token list per chain:
 *   - `/coins/markets` ordered by market capitalisation: rank, name, symbol, logo;
 *   - `/coins/list?include_platform=true`: which contract address a coin has on which chain;
 *   - `/token_lists/{platform}/all.json`: decimals (and a spare logo) by contract address.
 */
import { isValidPlatformAddress, normalizePlatformAddress, type ResolvedPlatform } from './coingecko-platforms'

/** A coin as `/coins/markets` describes it. */
export type MarketCoin = {
  id: string
  symbol: string
  name: string
  /** Logo address; null when CoinGecko has none. */
  image: string | null
}

/** Contract address by CoinGecko platform id, for one coin. */
export type CoinPlatforms = Record<string, string>

/** Contract details a chain's CoinGecko token list holds, keyed by lowercase address. */
export type TokenListDetails = Map<string, { decimals: number; logoURI: string | null }>

/** A token ready to be stored. */
export type TopToken = {
  coinId: string
  name: string
  symbol: string
  /** Normalised contract address. */
  address: string
  decimals: number
  logoURI: string | null
  /** Zero-based position by market capitalisation among the chain's tokens. */
  orderIdx: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Read one `/coins/markets` row, or null when it lacks an id, a symbol or a name. */
export const parseMarketCoin = (raw: unknown): MarketCoin | null => {
  if (!isRecord(raw)) return null
  const { id, symbol, name, image } = raw
  if (typeof id !== 'string' || typeof symbol !== 'string' || typeof name !== 'string') return null
  if (!id || !symbol || !name) return null
  return { id, symbol, name, image: typeof image === 'string' && image ? image : null }
}

/** Read a whole `/coins/markets` page. Anything that is not an array gives an empty page. */
export const parseMarketPage = (raw: unknown): MarketCoin[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row) => parseMarketCoin(row) ?? [])
}

/** Read `/coins/list?include_platform=true` into platforms by coin id. A non-array gives an empty map. */
export const parseCoinPlatforms = (raw: unknown): Map<string, CoinPlatforms> => {
  const byCoin = new Map<string, CoinPlatforms>()
  if (!Array.isArray(raw)) return byCoin
  for (const row of raw) {
    if (!isRecord(row) || typeof row.id !== 'string' || !isRecord(row.platforms)) continue
    const platforms: CoinPlatforms = {}
    for (const [platformId, address] of Object.entries(row.platforms)) {
      if (typeof address === 'string') platforms[platformId] = address
    }
    byCoin.set(row.id, platforms)
  }
  return byCoin
}

/** Read a CoinGecko token list into details by lowercase address. Rows without a whole-number decimals are ignored. */
export const parseTokenListDetails = (raw: unknown): TokenListDetails => {
  const details: TokenListDetails = new Map()
  if (!isRecord(raw) || !Array.isArray(raw.tokens)) return details
  for (const token of raw.tokens) {
    if (!isRecord(token) || typeof token.address !== 'string') continue
    const { decimals, logoURI } = token
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) continue
    details.set(token.address.toLowerCase(), {
      decimals,
      logoURI: typeof logoURI === 'string' && logoURI ? logoURI : null,
    })
  }
  return details
}

/**
 * Pick a chain's top tokens.
 *
 * `rankedCoins` must already be ordered by market capitalisation, largest first; the answer
 * keeps that order. A coin counts for the chain when CoinGecko gives it a valid contract
 * address there. Two coins on one address keep only the larger. Native coins (ether, BNB)
 * have no contract address and so never appear.
 *
 * Decimals come from `details`; a token missing there gets 0, the value the full CoinGecko
 * collector stores. The logo is the market feed's, with the token list's as a fallback.
 */
export const selectTopTokens = ({
  rankedCoins,
  platformsByCoin,
  platformId,
  platform,
  details,
  limit,
}: {
  rankedCoins: readonly MarketCoin[]
  platformsByCoin: ReadonlyMap<string, CoinPlatforms>
  platformId: string
  platform: ResolvedPlatform
  details: TokenListDetails
  limit: number
}): TopToken[] => {
  const tokens: TopToken[] = []
  const seen = new Set<string>()
  for (const coin of rankedCoins) {
    if (tokens.length >= limit) break
    const rawAddress = platformsByCoin.get(coin.id)?.[platformId]
    if (!rawAddress || !isValidPlatformAddress(platform, rawAddress)) continue
    const address = normalizePlatformAddress(platform, rawAddress)
    if (seen.has(address)) continue
    seen.add(address)
    const detail = details.get(address.toLowerCase())
    tokens.push({
      coinId: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      address,
      decimals: detail?.decimals ?? 0,
      logoURI: coin.image ?? detail?.logoURI ?? null,
      orderIdx: tokens.length,
    })
  }
  return tokens
}

/**
 * Whether the ranked coins read so far already hold `limit` tokens for every given chain.
 * When they do, reading further pages cannot change any list.
 */
export const allChainsFilled = ({
  rankedCoins,
  platformsByCoin,
  chains,
  limit,
}: {
  rankedCoins: readonly MarketCoin[]
  platformsByCoin: ReadonlyMap<string, CoinPlatforms>
  chains: readonly { platformId: string; platform: ResolvedPlatform }[]
  limit: number
}): boolean =>
  chains.every(
    ({ platformId, platform }) =>
      selectTopTokens({ rankedCoins, platformsByCoin, platformId, platform, details: new Map(), limit }).length >=
      limit,
  )
