import { fetch } from '@/fetch'
import lists from '@/harvested/uniswap/lists.json'
import * as types from '@/types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { terminalRowTypes } from '@/log/types'
import { terminal } from '@/utils'
import { failureLog } from '@gibs/utils'

const domain = 'https://wispy-bird-88a7.uniswap.workers.dev/?url='
const providerKey = 'uniswap'

export const collect = async (signal: AbortSignal) => {
  const usable = Object.entries(lists).map(([key, item]) => {
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

  const listBlacklist = new Set<string>(['kleros-t-2-cr', 'testnet-tokens', 'coingecko'])
  const summaryRow = terminal.issue({
    id: providerKey,
    type: terminalRowTypes.SETUP,
  })
  const section = summaryRow.issue('uniswap-tokenlists', 16)
  summaryRow.createCounter('blacklisted', true)
  summaryRow.createCounter('complete', true)
  await promiseLimit<(typeof usable)[number]>(4).map(usable, async (info) => {
    const providerKey = `uniswap-${info.machineName}`
    const listKey = 'hosted'
    const id = `${providerKey}/${listKey}`
    if (listBlacklist.has(info.machineName)) {
      summaryRow.increment('blacklisted', info.machineName)
      return false
    }
    const task = section.task(id, {
      type: terminalRowTypes.STORAGE,
      id,
    })
    const result = await fetch(info.uri, { signal })
      .then(async (res) => (await res.json()) as types.TokenList)
      .catch(() => null)
    if (!result) {
      task.unmount()
      return false
    }
    // custom domain replacement logic
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
    if (signal.aborted) {
      return
    }
    const list = await inmemoryTokenlist
      .collect({
        providerKey,
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
  summaryRow.complete()
}
