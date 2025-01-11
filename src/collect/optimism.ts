import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'optimism',
  listKey: 'network',
  tokenList: 'https://static.optimism.io/optimism.tokenlist.json',
})
