import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'levinswap',
  listKey: 'exchange',
  tokenList:
    'https://ipfs.io/ipfs/QmUmN7Be3LLHiEwcVZDm6WsPjcTddWsc6C7hrLCmPzsanv?filename=levinswap-default.tokenlist.json',
})
