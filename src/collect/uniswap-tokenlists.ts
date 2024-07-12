import lists from '@/harvested/uniswap/lists.json'
import * as types from '@/types'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import promiseLimit from 'promise-limit'
import _ from 'lodash'
import { fetch } from '@/fetch'

const domain = 'https://wispy-bird-88a7.uniswap.workers.dev/?url='

export const collect = async () => {
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
  await promiseLimit<(typeof usable)[number]>(4).map(usable, async (info) => {
    if (listBlacklist.has(info.machineName)) return false
    const result = await fetch(info.uri)
      .then(async (res) => (await res.json()) as types.TokenList)
      .catch(() => null)
    if (!result) {
      return false
    }
    // custom domain replacement logic
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
    return await inmemoryTokenlist.collect(`uniswap-${info.machineName}`, 'hosted', result)
  })
}
