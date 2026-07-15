import { limitBy } from '@gibs/utils'
import * as db from '../db'
import { fetch } from '../fetch'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { parseChains, pickIconUrl, type ChainlistEntry } from './chainlist-parse'

const providerKey = 'chainlist'

/** The ethereum-lists / chainlist.org network registry. */
const chainsUrl = 'https://chainid.network/chains.json'
/** Each chains.json `icon` key resolves to a descriptor here (an ipfs:// image url). */
const iconMetaBaseUrl = 'https://raw.githubusercontent.com/ethereum-lists/chains/master/_data/icons'

class ChainlistCollector extends BaseCollector {
  readonly key = providerKey

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    await db.insertProvider({
      key: providerKey,
      name: 'Chainlist',
      description:
        'Ethereum-Virtual-Machine network breadth and canonical chain icons from the ethereum-lists/chains registry (chainid.network), as surfaced by chainlist.org.',
    })
    // Network-icon-only provider: no token lists to register (mirrors cryptocurrency-icons).
    return [{ providerKey, lists: [] }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const response = await fetch(chainsUrl, { signal })
    if (!response.ok) {
      console.warn(`chainlist: chains.json fetch failed with status ${response.status}`)
      return
    }
    const chains = parseChains(await response.json())
    console.warn(`chainlist: ${chains.length} icon-bearing chains to store`)

    await limitBy<ChainlistEntry>('chainlist', 16).map(chains, async (chain) => {
      if (signal.aborted) return
      await this.storeChain(chain, signal)
    })
  }

  private async storeChain(chain: ChainlistEntry, signal: AbortSignal) {
    const iconUrl = await this.resolveIconUrl(chain.icon, signal)
    if (!iconUrl) return

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

    await db.fetchImageAndStoreForNetwork({
      network,
      uri: iconUrl,
      originalUri: iconUrl,
      providerKey,
      signal,
    })
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
