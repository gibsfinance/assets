import * as trustwallet from './trustwallet'
import * as phux from './phux'
import * as pls369 from './pls369'
import * as internetmoney from './internetmoney'
import * as uniswapTokenlists from './uniswap-tokenlists'
import * as remoteTokenList from './remote-tokenlist'
import * as smoldapp from './smoldapp'
import * as omnibridge from './omnibridge'
import { bsc, mainnet, pulsechain } from 'viem/chains'

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
      provider: 'pulsechain',
      foreign: { chain: mainnet, address: '0xd0764FAe29E0a6a96fF685f71CfC685456D5636c', startBlock: 17_264_119 },
      home: { chain: pulsechain, address: '0x6ef79FD6f9f840264332884240539Ed7A2dA8b2b', startBlock: 17_268_302 },
    },
    {
      provider: 'tokensex',
      foreign: { chain: bsc, address: '0x8C0Db248E87F53e53f7D19A8Bd1CFAB16f5B69E7', startBlock: 28_987_322 },
      home: { chain: pulsechain, address: '0xa3177000d645c599e45f946240f9c2f46d26718b', startBlock: 17_494_240 },
    },
  ]),
}

export type Collectable = keyof typeof collectables
