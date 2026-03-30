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

const domain = 'https://wispy-bird-88a7.uniswap.workers.dev/?url='
const providerKey = 'uniswap'

type UsableEntry = {
  key: string
  uri: string
  machineName: string
  name: string
  homepage: string
}

const listBlacklist = new Set<string>(['kleros-t-2-cr', 'testnet-tokens', 'coingecko', 'agora-datafi-tokens'])

const buildUsableEntries = (): UsableEntry[] => {
  return Object.entries(lists).map(([key, item]) => {
    const suffixedKey = `${key}${key.slice(-4) === '.eth' ? '.link' : ''}`
    const fullKey = suffixedKey.startsWith('https://') ? suffixedKey : `https://${suffixedKey}`
    const uri = fullKey.endsWith('manifest.json') ? fullKey : `${domain}${fullKey}`
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

    await promiseLimit<UsableEntry>(4).map(this.usable, async (info) => {
      const subProviderKey = `uniswap-${info.machineName}`
      const listKey = 'hosted'
      if (listBlacklist.has(info.machineName)) {
        return
      }

      const result = await fetch(info.uri, { signal })
        .then(async (res) => (await res.json()) as types.TokenList)
        .catch(() => null)
      if (!result?.tokens) return

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

        if (listKey === 'hosted' && subProviderKey === 'uniswap-agora-datafi-tokens') {
          failureLog('%o', result.tokens)
        }
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
