import * as types from '../types'
import * as inmemoryTokenlist from './inmemory-tokenlist'

export const collect = async ({
  providerKey,
  tokenList: tokenListUrl,
}: {
  providerKey: string
  tokenList: string
}) => {
  const tokenList = await fetch(tokenListUrl)
    .then((res): Promise<types.TokenList> => res.json())
  return inmemoryTokenlist.collect(providerKey, tokenList)
}
