import { registeredCoinTypes } from 'slip44'
import * as db from '../db'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { resolveChains, type CatalogEntry, type ResolvedChain } from './non-evm-resolver'

const providerKey = 'cryptocurrency-icons'
const catalogUrl = 'https://raw.githubusercontent.com/ErikThiart/cryptocurrency-icons/refs/heads/master/coin_map.json'

/** Validate the fetched catalog into well-formed entries; tolerate junk. */
export const parseCatalog = (raw: unknown): CatalogEntry[] => {
  if (!Array.isArray(raw)) return []
  const clean: CatalogEntry[] = []
  for (const value of raw) {
    if (
      value &&
      typeof value.name === 'string' &&
      typeof value.symbol === 'string' &&
      typeof value.slug === 'string' &&
      typeof value.img_url === 'string' &&
      // Only accept secure remote icons. The catalog is a fixed trusted
      // source that already serves every icon over https, so this drops
      // nothing legitimate while refusing any relative or non-https path
      // that would otherwise reach the image fetcher's local-file branch.
      value.img_url.startsWith('https://')
    ) {
      clean.push({ name: value.name, symbol: value.symbol, slug: value.slug, img_url: value.img_url })
    }
  }
  return clean
}

class CryptocurrencyIconsCollector extends BaseCollector {
  readonly key = providerKey

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    await db.insertProvider({
      key: providerKey,
      name: 'Cryptocurrency Icons',
      description:
        'Coin logos for non-Ethereum-Virtual-Machine chains: the Satoshi-Labs-Improvement-Proposal-44 registry matched against the ErikThiart cryptocurrency-icons catalog.',
    })
    return [{ providerKey, lists: [] }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const response = await fetch(catalogUrl, { signal })
    if (!response.ok) {
      console.warn(`cryptocurrency-icons: catalog fetch failed with status ${response.status}`)
      return
    }
    const catalog = parseCatalog(await response.json())
    const { resolved, skipped } = resolveChains([...registeredCoinTypes], catalog)

    const skipCounts = skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1
      return acc
    }, {})
    console.warn(
      `cryptocurrency-icons: resolved ${resolved.length} chains; skipped ${skipped.length} ` +
        `(no-symbol ${skipCounts['no-symbol'] ?? 0}, reserved-evm ${skipCounts['reserved-evm'] ?? 0}, ` +
        `not-curated ${skipCounts['not-curated'] ?? 0}, no-icon ${skipCounts['no-icon'] ?? 0})`,
    )

    for (const chain of resolved) {
      if (signal.aborted) return
      await this.storeChain(chain, signal)
    }
  }

  private async storeChain(chain: ResolvedChain, signal: AbortSignal) {
    const network = await db.insertNetworkFromChainId(chain.identifier, chain.namespace)
    await db.fetchImageAndStoreForNetwork({
      network,
      uri: chain.imageUrl,
      originalUri: chain.imageUrl,
      providerKey,
      signal,
    })
  }
}

const instance = new CryptocurrencyIconsCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
