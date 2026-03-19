import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('optimism', {
  providerKey: 'optimism',
  listKey: 'network',
  tokenList: 'https://static.optimism.io/optimism.tokenlist.json',
})
