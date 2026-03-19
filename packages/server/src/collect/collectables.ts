import chains from '../chains'
import '../utils'
import countriesCollector from './countries'
import TrustWalletCollector from './trustwallet'
import pulsexCollector from './pulsex'
import phuxCollector from './phux'
import pls369Collector from './pls369'
import InternetMoneyCollector from './internetmoney'
import UniswapTokenListsCollector from './uniswap-tokenlists'
import { RemoteTokenListCollector } from './remote-tokenlist'
import SmoldappCollector from './smoldapp'
import OmnibridgeCollector from './omnibridge'
import pulsechainCollector from './pulsechain'
import nineMM from './9mm'
import levinswapCollector from './levinswap'
import honeyswapCollector from './honeyswap'
import pancakeCollector from './pancake'
import quickswapCollector from './quickswap'
import rollCollector from './roll'
import scrollCollector from './scroll'
import setCollector from './set'
import klerosCollector from './kleros'
import dfynCollector from './dfyn'
import CoinGeckoCollector from './coingecko'
import umaCollector from './uma'
import baofinanceCollector from './baofinance'
import compoundCollector from './compound'
import optimismCollector from './optimism'
import pumpiresCollector from './pumptires'
import dexscreenerCollector from './dexscreener'
import etherscanCollector from './etherscan'
import routescanCollector from './routescan'
import _ from 'lodash'
import gibsCollector from './gibs'

/**
 * Helper function to get all available collector keys
 */
export const allCollectables = () => {
  return Object.keys(collectables()) as Collectable[]
}

/**
 * Main registry of token collectors with their configurations.
 * Each value is a BaseCollector instance with discover() and collect() methods.
 */
export const collectables = _.memoize(() => {
  const { bsc, mainnet, pulsechain, sepolia, pulsechainV4 } = chains()
  return {
    dexscreener: dexscreenerCollector,
    countries: countriesCollector,
    routescan: routescanCollector,
    pulsechain: pulsechainCollector,
    trustwallet: new TrustWalletCollector(),
    'uniswap-tokenlists': new UniswapTokenListsCollector(),
    kleros: klerosCollector,
    gibs: gibsCollector,
    piteas: new RemoteTokenListCollector('piteas', {
      providerKey: 'piteas',
      listKey: 'exchange',
      tokenList: 'https://raw.githubusercontent.com/piteasio/app-tokens/main/piteas-tokenlist.json',
    }),
    pulsex: pulsexCollector,
    balancer: new RemoteTokenListCollector('balancer', {
      providerKey: 'balancer',
      listKey: 'exchange',
      tokenList: 'https://raw.githubusercontent.com/balancer/tokenlists/main/generated/balancer.tokenlist.json',
      blacklist: new Set(['0xEdF8b632b537d5993Adb5e2E15882CD791c284cB', '0xbf4906762C38F50bC7Be0A11BB452C944f6C72E1']),
    }),
    midgard: new RemoteTokenListCollector('midgard', {
      providerKey: 'midgard',
      listKey: 'all',
      tokenList:
        'https://raw.githubusercontent.com/pulsecoin-io/Midgard-tokenlist/refs/heads/main/midgard-tokenlist.json',
    }),
    internetmoney: new InternetMoneyCollector(),
    phux: phuxCollector,
    pls369: pls369Collector,
    smoldapp: new SmoldappCollector(),
    levinswap: levinswapCollector,
    honeyswap: honeyswapCollector,
    pancake: pancakeCollector,
    quickswap: quickswapCollector,
    roll: rollCollector,
    scroll: scrollCollector,
    set: setCollector,
    omnibridge: new OmnibridgeCollector([
      {
        providerPrefix: 'pulsechain',
        foreign: { chain: mainnet, address: '0x1715a3E4A142d8b698131108995174F37aEBA10D', startBlock: 17_264_119 },
        home: { chain: pulsechain, address: '0x4fD0aaa7506f3d9cB8274bdB946Ec42A1b8751Ef', startBlock: 17_268_302 },
      },
      {
        // for wpls
        providerPrefix: 'pulsechain',
        type: 'omnibridge-wpls',
        foreign: { chain: mainnet, address: '0xe20E337DB2a00b1C37139c873B92a0AAd3F468bF', startBlock: 17_264_119 },
        home: { chain: pulsechain, address: '0x0e18d0d556b652794EF12Bf68B2dC857EF5f3996', startBlock: 17_268_302 },
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
    dfyn: dfynCollector,
    coingecko: new CoinGeckoCollector(),
    '9mm': nineMM,
    uma: umaCollector,
    baofinance: baofinanceCollector,
    compound: compoundCollector,
    optimism: optimismCollector,
    pumptires: pumpiresCollector,
    etherscan: etherscanCollector,
  } as const
})

/**
 * Type definition for collectors to adhere to
 */
export type Collectable = keyof ReturnType<typeof collectables>
