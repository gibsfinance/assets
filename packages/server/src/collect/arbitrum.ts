import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * The Arbitrum whitelist ("Arb Whitelist Era"), covering Ethereum mainnet and
 * Arbitrum One bridged tokens.
 */
export default new RemoteTokenListCollector('arbitrum', {
  providerKey: 'arbitrum',
  providerName: 'Arbitrum',
  listKey: 'bridge',
  tokenList: 'https://tokenlist.arbitrum.io/ArbTokenLists/arbed_arb_whitelist_era.json',
})
