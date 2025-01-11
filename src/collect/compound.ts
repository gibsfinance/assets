import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'compound',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
})
