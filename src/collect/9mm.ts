import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: '9mm',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/9mm-exchange/app-tokens/refs/heads/main/9mm-tokenlist.json',
})
