import { failureLog } from '@gibs/utils'
import _ from 'lodash'

import * as db from '../db'
import * as types from '../types'
import * as utils from '../utils'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { terminalRowTypes } from '../log/types'
import { BaseCollector, DiscoveryManifest } from './base-collector'
import { parseTokenRecord } from './ethereum-lists-parse'

const providerKey = 'mew'
const providerName = 'MyEtherWallet'
const listKey = 'tokens-eth'
const MAINNET_CHAIN_ID = 1
const sourceUrl =
  'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/dist/tokens/eth/tokens-eth.json'

/**
 * Two-phase collector for MyEtherWallet's Ethereum mainnet token list, one of the
 * projects named in the ethereum-lists/tokens "Usages" section.
 *
 * MEW's list is the ancestor of ethereum-lists/tokens and shares its exact record
 * shape (symbol/name/address/decimals plus a `logo` object), so it reuses that
 * repository's parser and the inmemory-tokenlist ingestion path verbatim. It is a
 * bare JSON array of mainnet ERC-20 records rather than a Uniswap token-list
 * document, which is why it cannot ride the generic remote-tokenlist collector.
 * Most records carry no logo, so this is primarily a name/symbol/decimals source.
 */
class MewCollector extends BaseCollector {
  readonly key = providerKey

  private tokenList: types.TokenList | null = null
  private discovered: inmemoryTokenlist.DiscoveredState | null = null

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    const row = utils.terminal.issue({ type: terminalRowTypes.SETUP, id: providerKey })
    try {
      const raw = await db.cachedJSONRequest<unknown[]>(sourceUrl, signal, sourceUrl)
      if (signal.aborted) return []

      const records = Array.isArray(raw) ? raw : []
      const tokens = _.compact(records.map((record) => parseTokenRecord(record, MAINNET_CHAIN_ID)))
      if (tokens.length === 0) {
        failureLog('provider=%o produced no tokens from %o', providerKey, sourceUrl)
        return []
      }

      // Insert the provider with its name so the row never carries a null name.
      await db.insertProvider({ key: providerKey, name: providerName })

      const tokenList: types.TokenList = {
        name: 'MyEtherWallet: Ethereum',
        timestamp: new Date().toISOString(),
        version: { major: 1, minor: 0, patch: 0 },
        tokens,
      }
      const discovered = await inmemoryTokenlist.discover({ providerKey, listKey, tokenList, signal })
      if (!discovered) return []

      this.tokenList = tokenList
      this.discovered = discovered
      return [{ providerKey, lists: [{ listKey, listId: discovered.list.listId }] }]
    } finally {
      row.complete()
    }
  }

  async collect(signal: AbortSignal): Promise<void> {
    if (!this.tokenList || !this.discovered) return
    await inmemoryTokenlist.collect({
      providerKey,
      listKey,
      tokenList: this.tokenList,
      discovered: this.discovered,
      signal,
    })
  }
}

const instance = new MewCollector()
export default instance

/**
 * Standalone entry point that runs both phases, mirroring the other collectors'
 * convenience export.
 */
export const collect = async (signal: AbortSignal) => {
  await instance.discover(signal)
  await instance.collect(signal)
}
