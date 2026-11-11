/**
 * @module collect/etherscan-chains
 *
 * The chains the Etherscan collector knows how to probe: mainnets only, each with one
 * well-known token (that chain's USD Coin, or its bridged form) to ask `tokeninfo` about.
 *
 * A chain is listed here whether or not a free key can reach it. Which chains a given key may
 * use is not a fact the collector assumes; the probe asks Etherscan (see `etherscan-capability`).
 * The supported-chain page names the chains: https://docs.etherscan.io/supported-chains
 *
 * The probe token only has to be a real ERC-20 contract. A plan refusal arrives before any
 * token lookup, so a stale address would show as `other`, not as a wrong capability.
 */

/** A chain the collector can probe. */
export type EtherscanChain = {
  chainId: number
  name: string
  /** A well-known ERC-20 contract on this chain, for the capability probe. */
  knownToken: string
}

/** Every chain the collector can probe, in the order the check prints them. */
export const ETHERSCAN_CHAINS: readonly EtherscanChain[] = [
  { chainId: 1, name: 'Ethereum', knownToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  { chainId: 10, name: 'OP Mainnet', knownToken: '0x0b2c639c533813f4aa9d7837caf62653d097ff85' },
  { chainId: 56, name: 'BNB Smart Chain', knownToken: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' },
  { chainId: 100, name: 'Gnosis', knownToken: '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0' },
  { chainId: 137, name: 'Polygon', knownToken: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' },
  { chainId: 5000, name: 'Mantle', knownToken: '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9' },
  { chainId: 8453, name: 'Base', knownToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { chainId: 42161, name: 'Arbitrum One', knownToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
  { chainId: 42220, name: 'Celo', knownToken: '0xceba9300f2b948710d2653dd7b07f33a8b32118c' },
  { chainId: 43114, name: 'Avalanche C-Chain', knownToken: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e' },
  { chainId: 59144, name: 'Linea', knownToken: '0x176211869ca2b568f2a7d4ee941e073a821ee1ff' },
]

/**
 * The chains a run covers: every known chain, or only those whose id is in `chainIds`.
 * An id the collector has no probe token for is dropped, because the probe could not ask about it.
 */
export const selectChains = (chainIds: readonly number[] | null): EtherscanChain[] =>
  ETHERSCAN_CHAINS.filter((chain) => chainIds === null || chainIds.includes(chain.chainId))
