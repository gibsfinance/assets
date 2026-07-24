/**
 * @module collect/collectable-order
 * The collector priority order, best first, as a plain list of keys.
 *
 * This is the same order as the `collectables` map in `collectables.ts` — that map is
 * the registry, this is only its ordering, split out so code that needs to *rank* a
 * provider does not have to import every collector to find out. `collectables` pulls
 * in the whole collector graph (and through it chain configuration and command-line
 * arguments), which is far too much to drag into the database layer, and the database
 * layer is itself imported by every collector, so reaching for it there is circular.
 *
 * The two are kept in step by a test that compares this list against the map's own
 * keys, so adding a collector without listing it here fails the suite rather than
 * silently ranking it last.
 */
export const collectableOrder = [
  'gibs',
  'pulsex',
  'smoldapp',
  'dexscreener',
  'countries',
  'pulsechain',
  'internetmoney',
  'midgard',
  'pumptires',
  'etherscan',
  'routescan',
  'trustwallet',
  'piteas',
  'pls369',
  'balancer',
  'phux',
  'uniswap-tokenlists',
  'kleros',
  'levinswap',
  'honeyswap',
  'pancake',
  'quickswap',
  'scroll',
  'set',
  'omnibridge',
  'dfyn',
  'coingecko',
  '9mm',
  'uma',
  'baofinance',
  'compound',
  'optimism',
  'aave',
  'pancakeswap-extended',
  'pangolin',
  'arbitrum',
  'jupiter',
  'mew',
  'ethereum-lists',
  'cryptocurrency-icons',
  'chainlist',
] as const

const positionByKey = new Map<string, number>(collectableOrder.map((key, position) => [key, position]))

/**
 * Rank a collector for the purpose of claiming a shared slot — lower wins.
 *
 * An unknown or absent key sorts last. That is what lets an icon of unknown
 * provenance — every network row written before provenance was recorded — yield to
 * the first collector that claims it, rather than being frozen in place forever.
 */
export const collectablePriority = (providerKey: string | null | undefined): number =>
  positionByKey.get(providerKey ?? '') ?? Number.MAX_SAFE_INTEGER
