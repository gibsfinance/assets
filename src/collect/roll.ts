import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'roll',
  listKey: 'exchange',
  tokenList: 'https://app.tryroll.com/tokens.json',
})
