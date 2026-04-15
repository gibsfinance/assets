import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('uma', {
  providerKey: 'uma',
  listKey: 'exchange',
  tokenList:
    'https://raw.githubusercontent.com/UMAprotocol/website/faff59b2f03ef219c8d205c46f6be78cfc5c824b/public/uma.tokenlist.json',
})
