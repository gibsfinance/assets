import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'pancake',
  listKey: 'exchange',
  tokenList:
    'https://raw.githubusercontent.com/pancakeswap/pancake-toolkit/master/packages/token-lists/lists/pancakeswap-default.json',
})
