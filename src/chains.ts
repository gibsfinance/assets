import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

import {
  mainnet as viemMainnet,
  pulsechain as viemPulsechain,
  bsc as viemBSC,
  sepolia as viemSepolia,
  pulsechainV4 as viemPulsechainV4,
  type Chain,
} from 'viem/chains'
import { collect } from '@/args'
import _ from 'lodash'
// import { log } from './logger'

/**
 * Creates chain configurations with custom RPC endpoints
 * @return Object containing configured Chain instances
 */
export default _.memoize(() => {
  // updateStatus({
  //   provider: 'system',
  //   message: '🔗 Initializing chain configurations...',
  //   phase: 'setup',
  // })
  const { rpc1, rpc369, rpc56, rpc11155111, rpc943 } = collect()

  // Log RPC configurations
  // log('RPC Configuration %o', {
  //   [1]: rpc1.length,
  //   [369]: rpc369.length,
  //   [56]: rpc56.length,
  //   [11155111]: rpc11155111.length,
  //   [943]: rpc943.length,
  // })

  const mainnet = {
    ...viemMainnet,
    rpcUrls: {
      ...viemMainnet.rpcUrls,
      default: {
        ...viemMainnet.rpcUrls.default,
        http: rpc1,
      },
    },
  } as Chain

  const pulsechain = {
    ...viemPulsechain,
    rpcUrls: {
      ...viemPulsechain.rpcUrls,
      default: {
        ...viemPulsechain.rpcUrls.default,
        http: rpc369,
      },
    },
  } as Chain

  const bsc = {
    ...viemBSC,
    rpcUrls: {
      ...viemBSC.rpcUrls,
      default: {
        ...viemBSC.rpcUrls.default,
        http: rpc56.length ? rpc56 : process.env.RPC_56?.split(',') || viemBSC.rpcUrls.default.http,
      },
    },
  } as Chain

  const sepolia = {
    ...viemSepolia,
    rpcUrls: {
      ...viemSepolia.rpcUrls,
      default: {
        ...viemSepolia.rpcUrls.default,
        http: process.env.RPC_11155111?.split(',') || viemSepolia.rpcUrls.default.http,
      },
    },
  } as Chain
  const pulsechainV4 = {
    ...viemPulsechainV4,
    rpcUrls: {
      ...viemPulsechainV4.rpcUrls,
      default: {
        ...viemPulsechainV4.rpcUrls.default,
        http: process.env.RPC_943?.split(',') || viemPulsechainV4.rpcUrls.default.http,
      },
    },
  } as Chain

  // updateStatus({
  //   provider: 'system',
  //   message: '🔗 Chain configurations initialized',
  //   phase: 'complete',
  // })

  return {
    mainnet,
    pulsechain,
    bsc,
    sepolia,
    pulsechainV4,
  }
})
