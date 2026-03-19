import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('set', {
  providerKey: 'set',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/SetProtocol/uniswap-tokenlist/main/set.tokenlist.json',
})
