import tokenList from '../harvested/phux/369'
import * as types from '../types'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'phux'
const listKey = 'exchange'

class PhuxCollector extends BaseCollector {
  readonly key = 'phux'

  private getTokenList(): { tokenList: types.TokenList } {
    for (const [domain, list] of Object.entries(tokenList)) {
      const l = list as unknown as types.TokenList
      l.tokens.forEach((token) => {
        if (token.logoURI?.startsWith('/')) {
          token.logoURI = `${domain}${token.logoURI}`
        }
      })
      return { tokenList: l }
    }
    throw new Error('should never get here')
  }

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const { tokenList: tl } = this.getTokenList()

    await inmemoryTokenlist.discover({
      providerKey,
      listKey,
      tokenList: tl,
      isDefault: true,
      signal,
    })

    return [
      {
        providerKey,
        lists: [{ listKey }],
      },
    ]
  }

  async collect(signal: AbortSignal): Promise<void> {
    const { tokenList: tl } = this.getTokenList()

    await inmemoryTokenlist.collect({
      providerKey,
      listKey,
      tokenList: tl,
      isDefault: true,
      signal,
    })
  }
}

const instance = new PhuxCollector()
export default instance
export const collect = (signal: AbortSignal) => instance.collect(signal)
