import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('scroll', {
  providerKey: 'scroll',
  listKey: 'network',
  tokenList: 'https://raw.githubusercontent.com/scroll-tech/token-list/main/scroll.tokenlist.json',
})
