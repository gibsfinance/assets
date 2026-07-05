import type { RegisteredCoinType } from 'slip44'

/** A row from the ErikThiart cryptocurrency-icons catalog (an array of these). */
export type CatalogEntry = { name: string; symbol: string; slug: string; img_url: string }

/** A chain that resolved to a servable gib.show network with an icon. */
export type ResolvedChain = {
  identifier: string
  namespace: string
  reference: number
  name: string
  imageUrl: string
}

/** A coin type deliberately not turned into a network, with the reason why. */
export type SkippedCoin = {
  reference: number
  name: string
  reason: 'no-symbol' | 'reserved-evm' | 'not-curated' | 'no-icon'
}

/**
 * Curated namespace map for the chain families altar tracks — this is the whole
 * roster of chains served. A coin type absent from this map is skipped
 * ('not-curated'), never stored: its stored network.type would fall outside the
 * closed NON_EVM_NAMESPACES set in chain-id.ts, so its network_id hash would not
 * reproduce at lookup time and the logo would be unreachable. Widening to the
 * full Satoshi-Labs-Improvement-Proposal-44 catalog is deferred future work.
 * Keys are Satoshi-Labs-Improvement-Proposal-44 coin types.
 */
export const NAMESPACE_BY_COIN_TYPE: Record<number, string> = {
  0: 'bip122', // Bitcoin
  2: 'bip122', // Litecoin
  3: 'bip122', // Dogecoin
  5: 'bip122', // Dash
  121: 'bip122', // Horizen
  133: 'bip122', // Zcash
  145: 'bip122', // Bitcoin Cash
  175: 'bip122', // Ravencoin
  128: 'monero',
  501: 'solana',
  1852: 'cardano',
  144: 'memo', // XRP
  148: 'memo', // Stellar
  195: 'tvm', // Tron
}

/** Coin types served through another path; never create a duplicate network. */
export const SKIP_COIN_TYPES: ReadonlySet<number> = new Set([
  60, // Ether — every Ethereum-Virtual-Machine chain is served under eip155
])

/** Lowercase, hyphenate, and trim a name into a namespace-safe slug. */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const upscale = (rawUrl: string): string => rawUrl.replace('/32/', '/128/')

/**
 * Resolve the Satoshi-Labs-Improvement-Proposal-44 registry against the icon
 * catalog. Drives off the registry (real chains); the catalog only supplies
 * images. Only coin types in the curated NAMESPACE_BY_COIN_TYPE map are stored;
 * everything else is skipped as 'not-curated'. A curated chain matches an icon
 * by symbol first, then by slugified name.
 */
export const resolveChains = (
  coinTypes: RegisteredCoinType[],
  catalog: CatalogEntry[],
): { resolved: ResolvedChain[]; skipped: SkippedCoin[] } => {
  const bySymbol = new Map<string, CatalogEntry>()
  const bySlug = new Map<string, CatalogEntry>()
  for (const entry of catalog) {
    if (typeof entry.symbol === 'string' && !bySymbol.has(entry.symbol.toUpperCase())) {
      bySymbol.set(entry.symbol.toUpperCase(), entry)
    }
    if (typeof entry.slug === 'string') bySlug.set(entry.slug, entry)
  }

  const resolved: ResolvedChain[] = []
  const skipped: SkippedCoin[] = []

  for (const [reference, , symbol, name] of coinTypes) {
    if (!symbol) {
      skipped.push({ reference, name, reason: 'no-symbol' })
      continue
    }
    if (SKIP_COIN_TYPES.has(reference)) {
      skipped.push({ reference, name, reason: 'reserved-evm' })
      continue
    }
    const namespace = NAMESPACE_BY_COIN_TYPE[reference]
    if (!namespace) {
      skipped.push({ reference, name, reason: 'not-curated' })
      continue
    }
    const entry = bySymbol.get(symbol.toUpperCase()) ?? bySlug.get(slugify(name))
    if (!entry) {
      skipped.push({ reference, name, reason: 'no-icon' })
      continue
    }
    resolved.push({
      identifier: `${namespace}-${reference}`,
      namespace,
      reference,
      name,
      imageUrl: upscale(entry.img_url),
    })
  }

  return { resolved, skipped }
}
