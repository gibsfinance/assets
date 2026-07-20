import { RemoteTokenListCollector } from './remote-tokenlist'

/**
 * Pangolin's multi-chain list, centred on Avalanche with a long tail of other
 * Ethereum-Virtual-Machine chains (Songbird, Flare, Hedera, and more).
 */
export default new RemoteTokenListCollector('pangolin', {
  providerKey: 'pangolin',
  providerName: 'Pangolin',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/pangolindex/tokenlists/main/pangolin.tokenlist.json',
})
