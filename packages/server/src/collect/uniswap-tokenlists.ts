import { fetch } from '../fetch'
import lists from '../harvested/uniswap/lists.json'
import * as types from '../types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { terminalRowTypes } from '../log/types'
import { terminal } from '../utils'
import { failureLog } from '@gibs/utils'
import { BaseCollector, DiscoveryManifest } from './base-collector'

const providerKey = 'uniswap'

type UsableEntry = {
  key: string
  uri: string
  machineName: string
  name: string
  homepage: string
}

const listBlacklist = new Set<string>(['kleros-t-2-cr', 'testnet-tokens', 'coingecko', 'agora-datafi-tokens'])

/**
 * Turn a registry entry into a location to fetch.
 *
 * These used to go through a Cloudflare worker that exists to add
 * cross-origin headers for a browser. That worker is gone - every list routed
 * through it answered 404 - and it was never needed here in the first place:
 * this is server-side code, and the same-origin policy it worked around is a
 * browser rule. Of the 34 registered lists, exactly one was still arriving,
 * and only because its address ends in `manifest.json`, which the old code
 * happened to exempt. Fetched directly, 22 arrive, carrying about 46,000 token
 * entries that were being read as none - among them Uniswap's own default list
 * at 1,704 tokens and its token-pairs list at 30,128.
 *
 * A key ending in `.eth` still gains `.link`: that is an Ethereum Name Service
 * gateway, which is a real redirection rather than a proxy.
 */
const buildUsableEntries = (): UsableEntry[] => {
  return Object.entries(lists).map(([key, item]) => {
    const suffixedKey = `${key}${key.slice(-4) === '.eth' ? '.link' : ''}`
    const uri = suffixedKey.startsWith('https://') ? suffixedKey : `https://${suffixedKey}`
    return {
      key,
      uri,
      machineName: _.kebabCase(item.name.toLowerCase()),
      name: item.name,
      homepage: item.homepage,
    }
  })
}

/**
 * Two-phase collector for Uniswap token lists.
 * Phase 1 (discover): fetches the manifest JSON for each sub-list, creates sub-providers + lists.
 * Phase 2 (collect): processes tokens for each sub-list via inmemory-tokenlist.
 */
class UniswapTokenListsCollector extends BaseCollector {
  readonly key = 'uniswap-tokenlists'

  private usable: UsableEntry[] = []
  private fetchedLists = new Map<string, types.TokenList>()

  async discover(signal: AbortSignal): Promise<DiscoveryManifest> {
    this.usable = buildUsableEntries()
    const manifest: DiscoveryManifest = []
    const unreachable: string[] = []
    let attempted = 0

    await promiseLimit<UsableEntry>(4).map(this.usable, async (info) => {
      const subProviderKey = `uniswap-${info.machineName}`
      const listKey = 'hosted'
      if (listBlacklist.has(info.machineName)) {
        return
      }
      attempted += 1

      const result = await fetch(info.uri, { signal })
        .then(async (res) => (await res.json()) as types.TokenList)
        .catch(() => null)
      if (!result?.tokens) {
        // Counted rather than passed over. A list that stops answering looks
        // exactly like a list with nothing in it, and that is how this
        // collector came to fetch one of its thirty-four for years without
        // anything saying so.
        unreachable.push(info.name)
        return
      }

      // Apply URL fixes before discover
      applyTokenListFixes(result)

      // Store fetched list for collect phase
      this.fetchedLists.set(subProviderKey, result)

      // Run inmemory discover to create provider + list rows
      await inmemoryTokenlist.discover({
        providerKey: subProviderKey,
        listKey,
        tokenList: result,
        signal,
      })

      manifest.push({
        providerKey: subProviderKey,
        lists: [{ listKey }],
      })
    })

    if (unreachable.length) {
      // Counts what was asked, not what is registered: the blacklisted entries
      // are never fetched, so including them would report a failure rate for
      // requests that were never made.
      failureLog(
        'provider=%o %o of %o lists asked did not answer: %o',
        providerKey,
        unreachable.length,
        attempted,
        unreachable.join(', '),
      )
    }

    return manifest
  }

  async collect(signal: AbortSignal): Promise<void> {
    const summaryRow = terminal.issue({
      id: providerKey,
      type: terminalRowTypes.SETUP,
    })
    try {
      const section = summaryRow.issue('uniswap-tokenlists', 16)
      summaryRow.createCounter('blacklisted', true)
      summaryRow.createCounter('complete', true)
      await promiseLimit<UsableEntry>(4).map(this.usable, async (info) => {
        const subProviderKey = `uniswap-${info.machineName}`
        const listKey = 'hosted'
        const id = `${subProviderKey}/${listKey}`
        if (listBlacklist.has(info.machineName)) {
          summaryRow.increment('blacklisted', info.machineName)
          return false
        }
        const task = section.task(id, {
          type: terminalRowTypes.STORAGE,
          id,
        })

        // Use pre-fetched list from discover, or re-fetch if not available
        let result = this.fetchedLists.get(subProviderKey) ?? null
        if (!result) {
          result = await fetch(info.uri, { signal })
            .then(async (res) => (await res.json()) as types.TokenList)
            .catch(() => null)
          if (result) {
            applyTokenListFixes(result)
          }
        }
        if (!result) {
          task.unmount()
          return false
        }

        if (signal.aborted) return

        const list = await inmemoryTokenlist
          .collect({
            providerKey: subProviderKey,
            listKey,
            tokenList: result,
            row: task,
            signal,
          })
          .catch(() => {
            // just log the error - don't throw
            task.increment('erred', info.machineName)
            failureLog(`${info.machineName} failed to collect`)
          })
        summaryRow.increment('complete', info.machineName)
        task.unmount()
        return list
      })
    } finally {
      summaryRow.complete()
    }
  }
}

export default UniswapTokenListsCollector

/**
 * Apply standard URL fixes and blacklisting to a token list
 */
const applyTokenListFixes = (result: types.TokenList) => {
  if (
    result.logoURI?.includes('QmUJQF5rDNQn37ToqCynz6iecGqAmeKHDQCigJWpUwuVLN') ||
    result.logoURI?.includes('QmVcci4ztPzCPb896uP7wY6szWDAm1cRYbGTUVLbGVhby9')
  ) {
    result.logoURI = ''
  }
  result.tokens.forEach((token) => {
    const replacing = 'ethereum-optimism.github.io'
    if (token.logoURI?.includes(replacing)) {
      token.logoURI = token.logoURI.replace(replacing, 'static.optimism.io')
    }
    const replacingCloudflare = 'cloudflare-ipfs.com'
    if (token.logoURI?.includes(replacingCloudflare)) {
      token.logoURI = token.logoURI.replace(replacingCloudflare, 'ipfs.io')
    }
    if (token.logoURI) {
      token.logoURI = token.logoURI.split('?')[0]
      token.logoURI = token.logoURI.replace('hhttps://', 'https://')
    }
    if (
      token.logoURI === 'https://ipfs.io/ipfs/QmVDL8ji6HKEmt5gFo6Gi1roXk6SNifL3omG5RjRCGRMDH' ||
      token.logoURI?.includes('QmUJQF5rDNQn37ToqCynz6iecGqAmeKHDQCigJWpUwuVLN')
    ) {
      token.logoURI = ''
    }
  })
}

/**
 * Main collection function that processes Uniswap token lists
 */
export const collect = async (signal: AbortSignal) => {
  const collector = new UniswapTokenListsCollector()
  await collector.discover(signal)
  await collector.collect(signal)
}
