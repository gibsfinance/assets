import * as remoteTokenList from './remote-tokenlist'

export const collect = remoteTokenList.collect({
  providerKey: 'kleros',
  listKey: 'exchange',
  tokenList: 'https://t2crtokens.eth.limo/',
})
