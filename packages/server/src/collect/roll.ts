import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('roll', {
  providerKey: 'roll',
  listKey: 'exchange',
  tokenList: 'https://app.tryroll.com/tokens.json',
})
