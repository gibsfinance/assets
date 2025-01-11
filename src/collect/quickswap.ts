import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'quickswap',
  listKey: 'exchange',
  tokenList: 'https://unpkg.com/quickswap-default-token-list@1.2.29/build/quickswap-default.tokenlist.json',
})
