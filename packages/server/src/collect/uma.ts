import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'uma',
  listKey: 'exchange',
  tokenList:
    'https://raw.githubusercontent.com/UMAprotocol/website/faff59b2f03ef219c8d205c46f6be78cfc5c824b/public/uma.tokenlist.json',
})
