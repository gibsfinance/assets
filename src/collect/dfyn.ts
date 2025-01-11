import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'dfyn',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/dfyn/new-host/main/list-token.tokenlist.json',
})
