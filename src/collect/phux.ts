import tokenList from '@/harvested/phux/369'
import * as types from '@/types'
import * as inmemoryTokenlist from './inmemory-tokenlist'

export const collect = async () => {
  for (const [domain, list] of Object.entries(tokenList)) {
    const l = list as unknown as types.TokenList
    l.tokens.forEach((token) => {
      if (token.logoURI.startsWith('/')) {
        token.logoURI = `${domain}${token.logoURI}`
      }
    })
    return await inmemoryTokenlist.collect('phux', l)
  }
  throw new Error('should never get here')
}
