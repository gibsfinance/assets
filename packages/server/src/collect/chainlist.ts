import { limitBy } from '@gibs/utils'
import * as db from '../db'
import { fetch } from '../fetch'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { mergeRegistries, pickIconUrl, type ChainlistEntry } from './chainlist-parse'

const providerKey = 'chainlist'

/**
 * chainlist.org's registry, and the authority on which chain a number is.
 *
 * It carries 2,921 chains to ethereum-lists' 2,755 and disagrees with it about
 * 51 of them. Some of those are wording ("Ronin" against "Ronin Mainnet"), and
 * some are not: chain 999 is HyperEVM here and Wanchain Testnet there, and
 * chain 10001 is ETHW here and Smart Bitcoin Cash Testnet there.
 */
const authoritativeChainsUrl = 'https://chainlist.org/rpcs.json'
/**
 * ethereum-lists/chains, which is where the icon files live.
 *
 * Kept as the icon source rather than the identity source: its icon identifiers
 * resolve and chainlist.org's do not always, but its naming lags. Reading
 * identity from one and artwork from the other is only safe while they agree
 * about the chain, which `mergeRegistries` is what enforces.
 */
const iconRegistryUrl = 'https://chainid.network/chains.json'
/** Each icon identifier resolves to a descriptor here (an ipfs:// image url). */
const iconMetaBaseUrl = 'https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/icons'

class ChainlistCollector extends BaseCollector {
  readonly key = providerKey

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    await db.insertProvider({
      key: providerKey,
      name: 'Chainlist',
      description:
        'Ethereum-Virtual-Machine network breadth and canonical chain icons. Chain identity comes from chainlist.org, which is current; the artwork comes from the ethereum-lists/chains registry, which hosts it — and only where the two agree about which chain a number is.',
    })
    // Network-icon-only provider: no token lists to register (mirrors cryptocurrency-icons).
    return [{ providerKey, lists: [] }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const [authoritative, iconRegistry] = await Promise.all([
      this.fetchRegistry(authoritativeChainsUrl, signal),
      this.fetchRegistry(iconRegistryUrl, signal),
    ])
    // The authority is what decides identity, so losing it means the run cannot
    // say which chain a number is. Losing only the icon registry is survivable:
    // fewer icons resolve, and every name is still correct.
    if (authoritative === null) {
      console.warn('chainlist: skipping the run, the authoritative registry did not answer')
      return
    }
    const chains = mergeRegistries(authoritative, iconRegistry ?? [])
    console.warn(`chainlist: ${chains.length} chains to store`)

    await limitBy<ChainlistEntry>('chainlist', 16).map(chains, async (chain) => {
      if (signal.aborted) return
      await this.storeChain(chain, signal)
    })
  }

  private async storeChain(chain: ChainlistEntry, signal: AbortSignal) {
    const iconUrl = chain.icon ? await this.resolveIconUrl(chain.icon, signal) : null
    // A chain with neither artwork nor a name gives this collector nothing to do.
    if (!iconUrl && !chain.name && !chain.title) return

    let network
    try {
      network = await db.insertNetworkFromChainId(chain.chainId, 'evm')
    } catch {
      // insertNetworkFromChainId rejects a non-EVM chain mis-numbered as eip155
      // (isFakedEvmReference). chains.json does carry one: 728126428 is listed as
      // "Tron Mainnet" even though Tron belongs at tvm-195, so this fires on every
      // run. Skip the chain rather than abort the whole run.
      return
    }

    // The registry's naming for this chain is the only one that arrives alongside its
    // icon, so writing it here keeps label and logo from drifting apart. The title
    // rides along because it is where a codename-named testnet says what it is.
    await db.setNetworkNaming({ networkId: network.networkId, name: chain.name, title: chain.title })

    // A corrected name still lands when no icon may honestly be shown - that is
    // the whole point of the chains where the registries disagree.
    if (!iconUrl) return

    await db.fetchImageAndStoreForNetwork({
      network,
      uri: iconUrl,
      originalUri: iconUrl,
      providerKey,
      signal,
    })
  }

  /** Fetch one registry. Null means it did not answer; an empty list means it had nothing. */
  private async fetchRegistry(url: string, signal: AbortSignal): Promise<unknown | null> {
    const response = await fetch(url, { signal }).catch(() => null)
    if (!response || !response.ok) {
      console.warn(`chainlist: ${url} fetch failed with status ${response?.status ?? 'no response'}`)
      return null
    }
    return (await response.json()) as unknown
  }

  /** Resolve a chains.json icon key to its ipfs image url, caching the lookup. */
  private async resolveIconUrl(iconKey: string, signal: AbortSignal): Promise<string | null> {
    const descriptor = await db
      .cachedJSON<{ url?: string }[]>(`chainlist-icon:${iconKey}`, signal, async (sig) => {
        const res = await fetch(`${iconMetaBaseUrl}/${encodeURIComponent(iconKey)}.json`, { signal: sig })
        if (!res.ok) return []
        return (await res.json()) as { url?: string }[]
      })
      .catch(() => [])
    return pickIconUrl(descriptor)
  }
}

const instance = new ChainlistCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
