import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'scroll',
  listKey: 'network',
  tokenList: 'https://raw.githubusercontent.com/scroll-tech/token-list/main/scroll.tokenlist.json',
})
