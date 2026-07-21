import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * Aave's multi-chain token list (maintained in bgd-labs/aave-address-book).
 * Broad coverage across roughly two dozen Ethereum-Virtual-Machine chains.
 */
export default new RemoteTokenListCollector('aave', {
  providerKey: 'aave',
  providerName: 'Aave',
  listKey: 'all',
  tokenList: 'https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/tokenlist.json',
})
