import {
  mainnet as viemMainnet,
  pulsechain as viemPulsechain,
  bsc as viemBSC,
  sepolia as viemSepolia,
  pulsechainV4 as viemPulsechainV4,
  type Chain,
} from 'viem/chains'
import { collect } from '@/args'

const { rpc1, rpc369, rpc56 } = collect()

export const mainnet = {
  ...viemMainnet,
  rpcUrls: {
    ...viemMainnet.rpcUrls,
    default: {
      ...viemMainnet.rpcUrls.default,
      http: rpc1,
    },
  },
} as Chain
export const pulsechain = {
  ...viemPulsechain,
  rpcUrls: {
    ...viemPulsechain.rpcUrls,
    default: {
      ...viemPulsechain.rpcUrls.default,
      http: rpc369,
    },
  },
} as Chain
export const bsc = {
  ...viemBSC,
  rpcUrls: {
    ...viemBSC.rpcUrls,
    default: {
      ...viemBSC.rpcUrls.default,
      http: rpc56,
    },
  },
} as Chain
export const sepolia = {
  ...viemSepolia,
} as Chain
export const pulsechainV4 = {
  ...viemPulsechainV4,
} as Chain
