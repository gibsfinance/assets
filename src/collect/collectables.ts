import * as trustwallet from './trustwallet'
import * as phux from './phux'
import * as pls369 from './pls369'
import * as internetmoney from './internetmoney'
import * as uniswapTokenlists from './uniswap-tokenlists'
import * as remoteTokenList from './remote-tokenlist'
import * as smoldapp from './smoldapp'

export const collectables = {
  trustwallet: trustwallet.collect,
  'uniswap-tokenlists': uniswapTokenlists.collect,
  piteas: remoteTokenList.collect({
    providerKey: 'piteas',
    listKey: 'exchange',
    tokenList: 'https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json',
  }),
  pulsex: remoteTokenList.collect({
    providerKey: 'pulsex',
    listKey: 'exchange',
    tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
    extension: [{
      address: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
      logoURI: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png',
      network: {
        id: 369,
        isNetworkImage: true,
      },
    }],
  }),
  balancer: remoteTokenList.collect({
    providerKey: 'balancer',
    listKey: 'exchange',
    tokenList: 'https://raw.githubusercontent.com/balancer/tokenlists/main/generated/balancer.tokenlist.json',
  }),
  internetmoney: internetmoney.collect,
  phux: phux.collect,
  pls369: pls369.collect,
  smoldapp: smoldapp.collect,
}

export type Collectable = keyof typeof collectables
