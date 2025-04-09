import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

/**
 * @title Chain Configuration Manager
 * @notice Manages chain configurations with dynamic RPC endpoint support
 * @dev Changes from original version:
 * 1. Added dynamic RPC endpoint configuration from environment
 * 2. Enhanced status updates for chain initialization
 * 3. Improved error handling for RPC configurations
 * 4. Added support for testnet variants
 */

import {
  mainnet as viemMainnet,
  pulsechain as viemPulsechain,
  bsc as viemBSC,
  sepolia as viemSepolia,
  pulsechainV4 as viemPulsechainV4,
  type Chain,
} from 'viem/chains'
import { collect } from '@/args'
import { updateStatus } from '@/utils'

/**
 * @notice Creates chain configurations with custom RPC endpoints
 * @dev Changes:
 * 1. Added status updates for each chain configuration
 * 2. Enhanced RPC endpoint logging for debugging
 * 3. Improved configuration inheritance from viem chains
 * 4. Added support for environment-based RPC fallbacks
 * @return Object containing configured Chain instances
 */
export default () => {
  updateStatus('🔗 Initializing chain configurations...')
  const { rpc1, rpc369, rpc56, rpc11155111, rpc943 } = collect()

  // Log RPC configurations
  console.log('RPC Configuration:')
  console.log('Ethereum:', rpc1.length)
  console.log('PulseChain:', rpc369.length)
  console.log('BSC:', rpc56.length)
  console.log('Sepolia:', rpc11155111.length)
  console.log('PulseChainV4:', rpc943.length)
  console.log('---')

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
  updateStatus('⚡ Configured Ethereum mainnet...')

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
  updateStatus('⚡ Configured PulseChain...')

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
  updateStatus('⚡ Configured BSC...')

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
  updateStatus('✨ Chain configuration complete!')
  // process.stdout.write('\n')

  return {
    mainnet,
    pulsechain,
    bsc,
    sepolia,
    pulsechainV4,
  }
}
