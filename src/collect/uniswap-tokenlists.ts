/**
 * @title Uniswap Token Lists Collector
 * @notice Collects token information from Uniswap's curated token lists
 */

import { fetch } from '@/fetch'
import lists from '@/harvested/uniswap/lists.json'
import * as types from '@/types'
import _ from 'lodash'
import promiseLimit from 'promise-limit'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'
import * as inmemoryTokenlist from './inmemory-tokenlist'

const domain = 'https://wispy-bird-88a7.uniswap.workers.dev/?url='
const providerKey = 'uniswap'

export const collect = async () => {
  updateStatus({
    provider: providerKey,
    message: 'Processing Uniswap token lists...',
    phase: 'setup',
  } satisfies StatusProps)

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
  let processedLists = 0
  const totalLists = usable.length

  await promiseLimit<(typeof usable)[number]>(4).map(usable, async (info) => {
    processedLists++
    updateStatus({
      provider: providerKey,
      message: `Processing list: ${info.name}`,
      current: processedLists,
      total: totalLists,
      phase: 'processing',
    } satisfies StatusProps)

    if (listBlacklist.has(info.machineName)) {
      updateStatus({
        provider: providerKey,
        message: `Skipping blacklisted list: ${info.name}`,
        current: processedLists,
        total: totalLists,
        phase: 'processing',
      } satisfies StatusProps)
      return false
    }

    try {
      const result = await fetch(info.uri)
        .then(async (res) => (await res.json()) as types.TokenList)
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : String(err)
          updateStatus({
            provider: providerKey,
            message: `Failed to fetch list ${info.name}: ${errorMessage}`,
            current: processedLists,
            total: totalLists,
            phase: 'processing',
          } satisfies StatusProps)
          return null
        })

      if (!result) {
        return false
      }

      updateStatus({
        provider: providerKey,
        message: `Processing ${result.tokens.length} tokens from ${info.name}`,
        current: processedLists,
        total: totalLists,
        phase: 'processing',
      } satisfies StatusProps)

      // Custom domain replacement logic
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
        if (token.logoURI === 'https://ipfs.io/ipfs/QmVDL8ji6HKEmt5gFo6Gi1roXk6SNifL3omG5RjRCGRMDH') {
          token.logoURI = ''
        }
      })

      updateStatus({
        provider: providerKey,
        message: `Storing tokens from ${info.name}`,
        current: processedLists,
        total: totalLists,
        phase: 'storing',
      } satisfies StatusProps)

      return await inmemoryTokenlist.collect(`uniswap-${info.machineName}`, 'hosted', result)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      updateStatus({
        provider: providerKey,
        message: `Error processing ${info.name}: ${errorMessage}`,
        current: processedLists,
        total: totalLists,
        phase: 'processing',
      } satisfies StatusProps)
      return false
    }
  })

  updateStatus({
    provider: providerKey,
    message: 'Token list collection complete',
    phase: 'complete',
  } satisfies StatusProps)
}
