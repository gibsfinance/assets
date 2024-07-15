import * as trustwallet from './trustwallet'
import * as phux from './phux'
import * as pls369 from './pls369'
import * as internetmoney from './internetmoney'
import * as uniswapTokenlists from './uniswap-tokenlists'
import * as remoteTokenList from './remote-tokenlist'
import * as smoldapp from './smoldapp'
import * as omnibridge from './omnibridge'
import { bsc, mainnet, pulsechain } from '@/chains'

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
    extension: [
      {
        address: '0xA1077a294dDE1B09bB078844df40758a5D0f9a27',
        logoURI: 'https://tokens.app.pulsex.com/images/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27.png',
        network: {
          id: 369,
          isNetworkImage: true,
        },
      },
    ],
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
  omnibridge: omnibridge.collect([
    {
      providerPrefix: 'pulsechain',
      foreign: { chain: mainnet, address: '0x1715a3E4A142d8b698131108995174F37aEBA10D', startBlock: 17_264_119 },
      home: { chain: pulsechain, address: '0x4fD0aaa7506f3d9cB8274bdB946Ec42A1b8751Ef', startBlock: 17_268_302 },
    },
    {
      providerPrefix: 'tokensex',
      foreign: { chain: bsc, address: '0xb4005881e81a6ecd2c1f75d58e8e41f28d59c6b1', startBlock: 28_987_322 },
      home: { chain: pulsechain, address: '0xf1DFc63e10fF01b8c3d307529b47AefaD2154C0e', startBlock: 17_494_240 },
    },
  ]),
}

export type Collectable = keyof typeof collectables
