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
  reason: 'reserved-evm' | 'not-curated' | 'no-icon'
}

/**
 * How a curated chain's logo is chosen. `iconSlug` is an explicit catalog slug
 * — slugs are unique in the icon catalog, so pinning one is deterministic and
 * collision-proof (unlike matching by ticker symbol, where a same-ticker meme or
 * wrapped token that sorts earlier in the catalog silently wins, and the winner
 * drifts as the catalog grows). `iconUrl`, when set, is used verbatim as the
 * logo source for a chain the catalog lacks or mis-serves, bypassing the catalog
 * lookup entirely.
 */
export type CuratedChain = { namespace: string; iconSlug: string; iconUrl?: string }

/**
 * Curated roster for the chain families gib.show serves — the whole set of
 * non-Ethereum-Virtual-Machine chains stored. A coin type absent from this map
 * is skipped ('not-curated'), never stored: its stored network.type would fall
 * outside the closed NON_EVM_NAMESPACES set in chain-id.ts, so its network_id
 * hash would not reproduce at lookup time and the logo would be unreachable.
 * Widening to the full Satoshi-Labs-Improvement-Proposal-44 catalog is deferred
 * future work. Keys are Satoshi-Labs-Improvement-Proposal-44 coin types; each
 * `iconSlug` is pinned to the canonical catalog entry for that chain.
 */
export const NAMESPACE_BY_COIN_TYPE: Record<number, CuratedChain> = {
  0: { namespace: 'bip122', iconSlug: 'bitcoin' },
  2: { namespace: 'bip122', iconSlug: 'litecoin' },
  3: { namespace: 'bip122', iconSlug: 'dogecoin' },
  5: { namespace: 'bip122', iconSlug: 'dash' },
  121: { namespace: 'bip122', iconSlug: 'horizen' },
  133: { namespace: 'bip122', iconSlug: 'zcash' },
  145: { namespace: 'bip122', iconSlug: 'bitcoin-cash' },
  175: { namespace: 'bip122', iconSlug: 'ravencoin' },
  128: { namespace: 'monero', iconSlug: 'monero' },
  501: { namespace: 'solana', iconSlug: 'solana' },
  // Satoshi-Labs-Improvement-Proposal-44 coin type for Cardano is 1815 (1852 is
  // the derivation purpose, not the coin type). The slug 'cardano' is the real
  // chain; a distinct 'ada' token shares the ADA ticker and would win a
  // symbol-first match.
  1815: { namespace: 'cardano', iconSlug: 'cardano' },
  144: { namespace: 'memo', iconSlug: 'xrp' },
  148: { namespace: 'memo', iconSlug: 'stellar' },
  195: { namespace: 'tvm', iconSlug: 'tron' },
  // Additional non-Ethereum-Virtual-Machine chains. Each namespace must also be
  // registered in NON_EVM_NAMESPACES (chain-id.ts) or the logo is unservable.
  118: { namespace: 'cosmos', iconSlug: 'cosmos' }, // coin type is labelled "Atom" in the registry
  607: { namespace: 'ton', iconSlug: 'toncoin' }, // The Open Network
  637: { namespace: 'aptos', iconSlug: 'aptos' },
  784: { namespace: 'sui', iconSlug: 'sui' },
}

/** Coin types served through another path; never create a duplicate network. */
export const SKIP_COIN_TYPES: ReadonlySet<number> = new Set([
  60, // Ether — every Ethereum-Virtual-Machine chain is served under eip155
])

const upscale = (rawUrl: string): string => rawUrl.replace('/32/', '/128/')

/**
 * Pick a curated chain's logo URL: the explicit `iconUrl` override verbatim when
 * set, otherwise the pinned catalog slug's image upscaled to 128px. Returns
 * undefined when a pinned slug is absent from the catalog — the chain then fails
 * safe (no icon) rather than serving a wrong one.
 */
const resolveImageUrl = (chain: CuratedChain, bySlug: Map<string, CatalogEntry>): string | undefined => {
  if (chain.iconUrl) return chain.iconUrl
  const entry = bySlug.get(chain.iconSlug)
  return entry ? upscale(entry.img_url) : undefined
}

/**
 * Resolve the Satoshi-Labs-Improvement-Proposal-44 registry against the icon
 * catalog. Drives off the registry (real chains); the catalog only supplies
 * images. Only coin types in the curated NAMESPACE_BY_COIN_TYPE map are stored;
 * everything else is skipped as 'not-curated'. Each curated chain's logo is
 * chosen by its explicit pinned slug (or iconUrl override) — never by ticker
 * symbol, which collides with same-ticker impostors and drifts as the catalog
 * grows.
 */
export const resolveChains = (
  coinTypes: RegisteredCoinType[],
  catalog: CatalogEntry[],
): { resolved: ResolvedChain[]; skipped: SkippedCoin[] } => {
  const bySlug = new Map<string, CatalogEntry>()
  for (const entry of catalog) {
    if (typeof entry.slug === 'string' && !bySlug.has(entry.slug)) bySlug.set(entry.slug, entry)
  }

  const resolved: ResolvedChain[] = []
  const skipped: SkippedCoin[] = []

  for (const [reference, , , name] of coinTypes) {
    if (SKIP_COIN_TYPES.has(reference)) {
      skipped.push({ reference, name, reason: 'reserved-evm' })
      continue
    }
    const chain = NAMESPACE_BY_COIN_TYPE[reference]
    if (!chain) {
      skipped.push({ reference, name, reason: 'not-curated' })
      continue
    }
    const imageUrl = resolveImageUrl(chain, bySlug)
    if (!imageUrl) {
      skipped.push({ reference, name, reason: 'no-icon' })
      continue
    }
    resolved.push({
      identifier: `${chain.namespace}-${reference}`,
      namespace: chain.namespace,
      reference,
      name,
      imageUrl,
    })
  }

  return { resolved, skipped }
}
