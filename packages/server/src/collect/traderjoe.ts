import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * Trader Joe's default multi-chain list (Avalanche, Arbitrum, and others).
 */
export default new RemoteTokenListCollector('traderjoe', {
  providerKey: 'traderjoe',
  providerName: 'Trader Joe',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/traderjoe-xyz/joe-tokenlists/main/mc.tokenlist.json',
})
