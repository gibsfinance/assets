import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * The Celo community token list.
 */
export default new RemoteTokenListCollector('celo', {
  providerKey: 'celo',
  providerName: 'Celo',
  listKey: 'network',
  tokenList: 'https://raw.githubusercontent.com/celo-org/celo-token-list/master/celo.tokenlist.json',
})
