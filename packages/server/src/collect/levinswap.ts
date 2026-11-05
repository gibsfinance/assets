import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('levinswap', {
  providerKey: 'levinswap',
  listKey: 'exchange',
  // Named by content hash and fetched through the shared IPFS path (`src/fetch.ts`),
  // which tries each configured gateway in turn. The old address pointed at ipfs.io,
  // which now answers every server request with HTTP 429.
  tokenList: 'ipfs://QmUmN7Be3LLHiEwcVZDm6WsPjcTddWsc6C7hrLCmPzsanv',
})
