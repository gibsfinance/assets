import { mainnet as viemMainnet, pulsechain as viemPulsechain, bsc as viemBSC, type Chain } from 'viem/chains'

export const mainnet = {
  ...viemMainnet,
  rpcUrls: {
    default: {
      http: [process.env.RPC_1 || 'https://rpc-ethereum.g4mm4.io'],
    },
  },
} as Chain
export const pulsechain = {
  ...viemPulsechain,
  rpcUrls: {
    default: {
      http: [process.env.RPC_369 || 'https://rpc-pulsechain.g4mm4.io'],
    },
  },
} as Chain
export const bsc = {
  ...viemBSC,
  rpcUrls: {
    default: {
      http: [process.env.RPC_56 || 'https://bsc-pokt.nodies.app'],
    },
  },
} as Chain
