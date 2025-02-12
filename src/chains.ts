import {
  mainnet as viemMainnet,
  pulsechain as viemPulsechain,
  bsc as viemBSC,
  sepolia as viemSepolia,
  pulsechainV4 as viemPulsechainV4,
  type Chain,
} from 'viem/chains'
import { collect } from '@/args'

export default () => {
  const { rpc1, rpc369, rpc56 } = collect()

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
        http: rpc56,
      },
    },
  } as Chain
  const sepolia = {
    ...viemSepolia,
  } as Chain
  const pulsechainV4 = {
    ...viemPulsechainV4,
  } as Chain
  return {
    mainnet,
    pulsechain,
    bsc,
    sepolia,
    pulsechainV4,
  }
}
