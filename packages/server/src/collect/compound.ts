import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('compound', {
  providerKey: 'compound',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/compound-finance/token-list/master/compound.tokenlist.json',
})
