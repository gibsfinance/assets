import { limitBy } from '@gibs/utils'
import * as db from '../db'
import { fetch } from '../fetch'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { parseNetworkEntries, type Web3IconsCollectEntry } from './web3icons-parse'

const providerKey = 'web3icons'

/**
 * 0xa3k5/web3icons' network metadata, and the branded icon set it points at.
 *
 * A curated, actively-maintained, mostly-vector artwork set — but it supplies
 * artwork only, never identity. Chain identity is chainlist.org's job (see
 * chainlist.ts): this collector attaches an icon to a network this project
 * already holds and never creates one, so it cannot make this project believe
 * a chain exists, or rename one, on the strength of a third-party icon set.
 *
 * Matching happens on `caip2id` alone, converted to this project's own chain
 * identifier form (`eip155:324` -> `eip155-324`). Matching by name is exactly
 * the mistake this codebase has already been burned by twice — chain 999 is
 * HyperEVM to one registry and Wanchain Testnet to another — so an entry
 * without a usable `caip2id` is skipped and counted, never guessed at.
 */
const metadataUrl = 'https://raw.githubusercontent.com/0xa3k5/web3icons/main/packages/common/src/metadata/networks.json'

class Web3IconsCollector extends BaseCollector {
  readonly key = providerKey

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    await db.insertProvider({
      key: providerKey,
      name: 'web3icons',
      description:
        'Curated, actively-maintained network artwork from 0xa3k5/web3icons. Artwork only: a network must already exist here, matched by its caip2id, before this source may attach an icon to it.',
    })
    // Network-icon-only provider: no token lists to register (mirrors chainlist).
    return [{ providerKey, lists: [] }]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const raw = await this.fetchMetadata(signal)
    if (raw === null) {
      console.warn('web3icons: skipping the run, the metadata feed did not answer')
      return
    }
    const entries = parseNetworkEntries(raw)
    const networksByChainId = await this.loadExistingNetworks()

    let matched = 0
    let unmatched = 0
    await limitBy<Web3IconsCollectEntry>('web3icons', 16).map(entries, async (entry) => {
      if (signal.aborted) return
      const network = networksByChainId.get(entry.chainId)
      // Artwork only: an identifier with no network already on file gets no row
      // created for it here. Identity is chainlist's job, not this collector's.
      if (!network) {
        unmatched += 1
        return
      }
      matched += 1
      await db.fetchImageAndStoreForNetwork({
        network,
        uri: entry.iconUrl,
        originalUri: entry.iconUrl,
        providerKey,
        signal,
      })
    })
    console.warn(`web3icons: ${matched} networks matched and collected, ${unmatched} matched no existing network`)
  }

  /** Fetch the network metadata file. Null means it did not answer. */
  private async fetchMetadata(signal: AbortSignal): Promise<unknown | null> {
    const response = await fetch(metadataUrl, { signal }).catch(() => null)
    if (!response || !response.ok) {
      console.warn(`web3icons: ${metadataUrl} fetch failed with status ${response?.status ?? 'no response'}`)
      return null
    }
    return (await response.json()) as unknown
  }

  /** Every network this project already holds, keyed by its chain identifier. */
  private async loadExistingNetworks() {
    const networks = await db.getNetworks()
    return new Map(networks.map((network) => [network.chainId, network]))
  }
}

const instance = new Web3IconsCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
