import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'quickswap',
  listKey: 'exchange',
  tokenList: 'https://unpkg.com/quickswap-default-token-list@1.2.29/build/quickswap-default.tokenlist.json',
  blacklist: new Set(['0x87f654c4b347230C60CAD8d7ea9cF0D7238bcc79']),
})
