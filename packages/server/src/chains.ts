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
import { collect } from './args'
import { rpcEndpointUrls } from '@gibs/utils'
import _ from 'lodash'

/**
 * Resolve a chain's RPC URL list: CLI args first, then the env var, then viem's
 * defaults. Entries may carry a `|<weight>` suffix for the load balancer, but a
 * chain config holds URLs only, so the weight is stripped here.
 */
const resolveRpcUrls = (fromArgs: string[], envValue: string | undefined, fallback: readonly string[]): string[] => {
  const specs = fromArgs.length ? fromArgs : envValue?.split(',').filter(Boolean) || fallback
  return rpcEndpointUrls(specs)
}

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
        http: rpcEndpointUrls(rpc1),
      },
    },
  } as Chain

  const pulsechain = {
    ...viemPulsechain,
    rpcUrls: {
      ...viemPulsechain.rpcUrls,
      default: {
        ...viemPulsechain.rpcUrls.default,
        http: rpcEndpointUrls(rpc369),
      },
    },
  } as Chain

  const bsc = {
    ...viemBSC,
    rpcUrls: {
      ...viemBSC.rpcUrls,
      default: {
        ...viemBSC.rpcUrls.default,
        http: resolveRpcUrls(rpc56, process.env.RPC_56, viemBSC.rpcUrls.default.http),
      },
    },
  } as Chain

  const sepolia = {
    ...viemSepolia,
    rpcUrls: {
      ...viemSepolia.rpcUrls,
      default: {
        ...viemSepolia.rpcUrls.default,
        http: resolveRpcUrls(rpc11155111, process.env.RPC_11155111, viemSepolia.rpcUrls.default.http),
      },
    },
  } as Chain
  const pulsechainV4 = {
    ...viemPulsechainV4,
    rpcUrls: {
      ...viemPulsechainV4.rpcUrls,
      default: {
        ...viemPulsechainV4.rpcUrls.default,
        http: resolveRpcUrls(rpc943, process.env.RPC_943, viemPulsechainV4.rpcUrls.default.http),
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
