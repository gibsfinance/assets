import * as db from '../db'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'pulsechain'

class PulsechainCollector extends BaseCollector {
  readonly key = 'pulsechain'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    await db.insertProvider({
      key: providerKey,
      name: 'PulseChain',
      description: 'a grass roots list curated by pulsechain devs',
    })

    return [
      {
        providerKey,
        lists: [],
      },
    ]
  }

  async collect(_signal: AbortSignal): Promise<void> {
    // Stub — only inserts the provider (done in discover)
  }
}

const instance = new PulsechainCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
