import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'honeyswap',
  listKey: 'exchange',
  tokenList: 'https://tokens.honeyswap.org/',
})
