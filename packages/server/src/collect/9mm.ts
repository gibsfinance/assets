import { RemoteTokenListCollector } from './remote-tokenlist'

export default new RemoteTokenListCollector('9mm', {
  providerKey: '9mm',
  listKey: 'exchange',
  tokenList: 'https://raw.githubusercontent.com/ninemm-pro/app-tokens/main/9mm-tokenlist.json',
})
