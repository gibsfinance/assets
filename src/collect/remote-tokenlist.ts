import * as types from '@/types'
import * as inmemoryTokenlist from './inmemory-tokenlist'
import { fetch } from '@/fetch'

export const collect = ({ providerKey, tokenList: tokenListUrl }: { providerKey: string; tokenList: string }) => async () => {
  const tokenList = await fetch(tokenListUrl)
    .then((res): Promise<types.TokenList> => res.json())
  return inmemoryTokenlist.collect(providerKey, tokenList)
}
