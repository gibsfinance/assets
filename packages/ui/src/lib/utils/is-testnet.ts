/**
 * Classify a chain as a testnet from its display name.
 *
 * Name matching is a heuristic, but measurement says it is the best signal available
 * — better than the structured fields that look more authoritative:
 *
 *  - `slip44` looks canonical (SLIP-0044 reserves coin type 1 for "Testnet (all
 *    coins)") and correctly marks Sepolia, Goerli, Holesky, Amoy and friends. But it
 *    is only set on 783 of 2,657 registry chains, and enough projects copy `slip44: 1`
 *    onto a mainnet that using it would hide real chains — World Chain, CrossFi,
 *    Treasure and Lumoz all claim it. Precise where present, absent where needed, and
 *    wrong often enough to cost more than it gains.
 *  - `faucets` is worse: mainnets publish faucets too. Gnosis, Injective, Immutable
 *    zkEVM, Beam and Vana all list one.
 *  - viem's `chain.testnet` is hand-curated and accurate, but covers only ~28% of the
 *    chains served here and is optional — 23 of its 244 testnet-named chains leave it
 *    undefined, so `=== true` quietly reads them as mainnet.
 *
 * Against viem's explicit flags, this pattern misses 22 of the chains served (down
 * from 39 for a plain "testnet" substring) and wrongly flags none.
 *
 * The residue is unreachable by pattern: project-specific codenames that carry no
 * signal in the string — Puppynet, Curtis, Bepolia, bArtio, Jolnir, Zhejiang, Shasta,
 * Topaz. Naming them individually would be a list to maintain by hand, not a rule.
 * They are counted as mainnets, which shows a few extra chains rather than hiding a
 * real one — the safer direction to be wrong in.
 */

/**
 * `testnet`/`devnet` are matched unanchored: the registry ships "Core Blockchain
 * Testnet2", and a trailing word boundary would not match a name ending in a digit.
 * No real word contains either as a substring, so there is nothing to guard against.
 */
const TESTNET_WORDS = /testnet|devnet/i

/**
 * Testnet families whose names never say "testnet". Word-bounded so they cannot fire
 * from inside an unrelated name.
 */
const TESTNET_NAMES =
  /\b(sepolia|goerli|holesky|kovan|rinkeby|ropsten|amoy|mumbai|fuji|chiado|alfajores|previewnet|moonbase)\b/i

/**
 * True when a chain's display name identifies it as a testnet.
 *
 * @param name Resolved display name, as produced by getNetworkName.
 */
export const isTestnetName = (name: string): boolean => TESTNET_WORDS.test(name) || TESTNET_NAMES.test(name)
