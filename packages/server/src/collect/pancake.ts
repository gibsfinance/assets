import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('pancake', {
  providerKey: 'pancake',
  listKey: 'exchange',
  tokenList:
    'https://raw.githubusercontent.com/pancakeswap/pancake-toolkit/master/packages/token-lists/lists/pancakeswap-default.json',
})
