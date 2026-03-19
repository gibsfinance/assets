import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('levinswap', {
  providerKey: 'levinswap',
  listKey: 'exchange',
  tokenList:
    'https://ipfs.io/ipfs/QmUmN7Be3LLHiEwcVZDm6WsPjcTddWsc6C7hrLCmPzsanv?filename=levinswap-default.tokenlist.json',
})
