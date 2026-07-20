import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * SpookySwap's default list for Fantom.
 */
export default new RemoteTokenListCollector('spookyswap', {
  providerKey: 'spookyswap',
  providerName: 'SpookySwap',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/SpookySwap/spooky-info/master/src/constants/token/spookyswap.json',
})
