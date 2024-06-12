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
  await promiseLimit<typeof usable[number]>(4).map(usable, async (info) => {
    if (info.machineName === 'kleros-t-2-cr') return false
    if (info.machineName === 'testnet-tokens') return false
    const providerKey = `uniswap-${info.machineName}`
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
      }
    })
    result.tokens = result.tokens.filter((token) => (
      token.logoURI !== 'https://ipfs.io/ipfs/QmVDL8ji6HKEmt5gFo6Gi1roXk6SNifL3omG5RjRCGRMDH'
    ))
    return await inmemoryTokenlist.collect(providerKey, result)
  })
}
