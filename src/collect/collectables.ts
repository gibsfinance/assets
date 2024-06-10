import * as trustwallet from './trustwallet'
import * as phux from './phux'
import * as pls369 from './pls369'
import * as internetmoney from './internetmoney'
import * as uniswapTokenlists from './uniswap-tokenlists'
import * as remoteTokenList from './remote-tokenlist'
import * as smoldapp from './smoldapp'
import * as balancer from './balancer'

export const collectables = {
  trustwallet: trustwallet.collect,
  'uniswap-tokenlists': uniswapTokenlists.collect,
  piteas: remoteTokenList.collect({
    providerKey: 'piteas',
    tokenList: 'https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json',
  }),
  pulsex: remoteTokenList.collect({
    providerKey: 'pulsex',
    tokenList: 'https://tokens.app.pulsex.com/pulsex-extended.tokenlist.json',
  }),
  balancer: remoteTokenList.collect({
    providerKey: 'balancer',
    tokenList: 'https://raw.githubusercontent.com/balancer/tokenlists/main/generated/balancer.tokenlist.json',
  }),
  internetmoney: internetmoney.collect,
  phux: phux.collect,
  pls369: pls369.collect,
  smoldapp: smoldapp.collect,
}

export type Collectable = keyof typeof collectables
