import type { NetworkInfo } from '../types'

/** Networks pinned to the head of the list, in this order. */
export const PRIORITY_CHAIN_IDS = ['1', '369'] as const

/**
 * Order networks for the picker: the two pinned chains first, then the rest by name.
 *
 * Reads the `name` and `isTestnet` that `useMetrics` already resolved rather than
 * deriving them again. Beyond being the single source, that fixes what deriving
 * them again got wrong: it passed the bare `chainId`, so every chain that is not
 * an Ethereum Virtual Machine chain looked up its coin type as if it were one —
 * Bitcoin (bip122-0) resolved to "Chain 0", sorted under C, and matched the
 * testnet filter on that same wrong string.
 *
 * @param networks - Every known network. Not modified.
 * @param options.showTestnets - Keep test networks in the result.
 */
export const sortNetworks = (networks: NetworkInfo[], { showTestnets }: { showTestnets: boolean }): NetworkInfo[] => {
  const filtered = showTestnets ? networks : networks.filter((network) => !network.isTestnet)
  const priority = PRIORITY_CHAIN_IDS as readonly string[]

  return [...filtered].sort((a, b) => {
    const aIndex = priority.indexOf(a.chainId.toString())
    const bIndex = priority.indexOf(b.chainId.toString())

    if (aIndex !== -1 && bIndex === -1) return -1
    if (aIndex === -1 && bIndex !== -1) return 1
    // Two pinned chains keep the order they are pinned in, which is why this
    // subtracts positions rather than falling through to the name comparison.
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex

    return a.name.localeCompare(b.name)
  })
}
