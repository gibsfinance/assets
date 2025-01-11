import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'honeswap',
  listKey: 'exchange',
  tokenList: 'https://tokens.honeyswap.org/',
})
