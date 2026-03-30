import * as db from '../db'
import * as fs from 'fs'
import * as path from 'path'
import * as paths from '../paths'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const pathToNativeV4Pulse = path.join(paths.harvested, 'gibs', 'images', '0x3af.png')

const providerKey = 'gibs'
const listKey = 'gibs'

const file = await fs.promises.readFile(pathToNativeV4Pulse)

class GibsCollector extends BaseCollector {
  readonly key = 'gibs'

  async discover(_signal: AbortSignal): Promise<DiscoveryManifest> {
    const [provider] = await db.insertProvider({
      key: providerKey,
    })
    await db.insertNetworkFromChainId(943)
    await db.insertList({
      providerId: provider.providerId,
      name: 'Gibs',
      key: listKey,
      default: true,
      major: 1,
      minor: 0,
      patch: 0,
      imageHash: null,
    })

    return [
      {
        providerKey,
        lists: [{ listKey }],
      },
    ]
  }

  async collect(_signal: AbortSignal): Promise<void> {
    const [provider] = await db.insertProvider({
      key: providerKey,
    })
    const network = await db.insertNetworkFromChainId(943)
    const [list] = await db.insertList({
      providerId: provider.providerId,
      name: 'Gibs',
      key: listKey,
      default: true,
      major: 1,
      minor: 0,
      patch: 0,
      imageHash: null,
    })
    await db.fetchImageAndStoreForToken({
      listId: list.listId,
      listTokenOrderId: 0,
      uri: file,
      originalUri: pathToNativeV4Pulse,
      providerKey,
      token: {
        name: 'V4 Pulse',
        symbol: 'V4PLS',
        decimals: 18,
        networkId: network.networkId,
        providedId: '0x70499adEBB11Efd915E3b69E700c331778628707',
      },
    })
  }
}

const instance = new GibsCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
