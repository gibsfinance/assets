/**
 * @title Token Collector Registry
 * @notice Registry of all available token collectors with their configurations
 * @dev Changes from original version:
 * 1. Added support for testnet collectors
 * 2. Enhanced bridge configurations with block numbers
 * 3. Added new collectors for various protocols
 * 4. Improved type safety with explicit chain imports
 */

import chains from '@/chains'
import * as trustwallet from './trustwallet'
import * as pulsex from './pulsex'
import * as phux from './phux'
import * as pls369 from './pls369'
import * as internetmoney from './internetmoney'
import * as uniswapTokenlists from './uniswap-tokenlists'
import * as remoteTokenList from './remote-tokenlist'
import * as smoldapp from './smoldapp'
import * as omnibridge from './omnibridge'
import * as pulsechainCollector from './pulsechain'
import * as nineMM from './9mm'
import * as levinswap from './levinswap'
import * as honeyswap from './honeyswap'
import * as pancake from './pancake'
import * as quickswap from './quickswap'
import * as roll from './roll'
import * as scroll from './scroll'
import * as set from './set'
import * as kleros from './kleros'
import * as dfyn from './dfyn'
import * as coingecko from './coingecko'
import * as uma from './uma'
import * as baofinance from './baofinance'
import * as compound from './compound'
import * as optimism from './optimism'
import * as pumptires from './pumptires'

/**
 * @notice Helper function to get all available collector keys
 * @dev Added to support dynamic collector discovery
 */
export const allCollectables = () => {
  return Object.keys(collectables()) as Collectable[]
}

/**
 * @notice Main registry of token collectors with their configurations
 * @dev Changes:
 * 1. Added PulseChain and testnet bridge configurations
 * 2. Enhanced remote token list collectors with explicit URLs
 * 3. Added new DEX and protocol collectors
 * 4. Improved configuration type safety with chain objects
 */
export const collectables = () => {
  const { bsc, mainnet, pulsechain, sepolia, pulsechainV4 } = chains()
  return {
    pulsechain: pulsechainCollector.collect,
    trustwallet: trustwallet.collect,
    'uniswap-tokenlists': uniswapTokenlists.collect,
    piteas: remoteTokenList.collect({
      providerKey: 'piteas',
      listKey: 'exchange',
      tokenList: 'https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json',
    }),
    pulsex: pulsex.collect,
    balancer: remoteTokenList.collect({
      providerKey: 'balancer',
      listKey: 'exchange',
      tokenList: 'https://raw.githubusercontent.com/balancer/tokenlists/main/generated/balancer.tokenlist.json',
    }),
    internetmoney: internetmoney.collect,
    phux: phux.collect,
    pls369: pls369.collect,
    smoldapp: smoldapp.collect,
    levinswap: levinswap.collect,
    honeyswap: honeyswap.collect,
    pancake: pancake.collect,
    quickswap: quickswap.collect,
    roll: roll.collect,
    scroll: scroll.collect,
    set: set.collect,
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
      {
        providerPrefix: 'pulsechain',
        testnetPrefix: 'v4',
        foreign: { chain: sepolia, address: '0x546e37DAA15cdb82fd1a717E5dEEa4AF08D4349A', startBlock: 3_332_081 },
        home: { chain: pulsechainV4, address: '0x6B08a50865aDeCe6e3869D9AfbB316d0a0436B6c', startBlock: 16_564_312 },
      },
    ]),
    kleros: kleros.collect,
    dfyn: dfyn.collect,
    coingecko: coingecko.collect,
    '9mm': nineMM.collect,
    uma: uma.collect,
    baofinance: baofinance.collect,
    compound: compound.collect,
    optimism: optimism.collect,
    pumptires: pumptires.collect,
  }
}

/**
 * @notice Type definition for available collectors
 * @dev Changed to use ReturnType for better type inference
 */
export type Collectable = keyof ReturnType<typeof collectables>
