/**
 * Classify a chain as a testnet from what the registry calls it.
 *
 * `title` is the load-bearing field. The ethereum-lists registry has no testnet
 * boolean, but it does let a chain state the fact in prose, and testnets whose *name*
 * is a codename routinely say it in the *title*:
 *
 *   { "name": "Adiri",             "title": "Telcoin Network Testnet" }
 *   { "name": "Ethereum Sepolia",  "title": "Ethereum Testnet Sepolia" }
 *   { "name": "Rinia",             "title": "Firechain Testnet Rinia" }
 *
 * Reading it is what DefiLlama's chainlist.org does too (utils/index.js `isTestnet`),
 * and measurement backs it: across the chains served here, adding `title` catches 27
 * testnets the name alone misses, and wrongly flags zero — no chain titles itself a
 * testnet while being a mainnet.
 *
 * The registry's structured fields all measured worse and are deliberately unused:
 *
 *  - `slip44` looks canonical (SLIP-0044 reserves coin type 1 for "Testnet (all
 *    coins)") and does mark Sepolia, Goerli and Holesky. But it is set on only 783 of
 *    2,657 chains, and enough projects copy `slip44: 1` onto a mainnet that it would
 *    hide real ones — World Chain, CrossFi, Treasure and Lumoz all claim it. Adding it
 *    moved misses 21 -> 20 while taking wrongly-hidden chains 1 -> 7. A net loss.
 *  - `faucets` is worse: mainnets publish them. Gnosis, Injective, Immutable zkEVM,
 *    Beam and Vana all list one.
 *  - `status` is only active / deprecated / incubating — it says nothing about testnets.
 *
 * Measured against viem's hand-curated `chain.testnet` (used only where it takes an
 * explicit position — the field is optional, and 23 of its 244 testnet-named chains
 * leave it undefined): this misses 21 of the chains served and wrongly flags none.
 *
 * The residue is chains that state it nowhere — Puppynet, Curtis, Bepolia, Jolnir,
 * Zhejiang, Shasta. They read as mainnets, which shows a few extra chains rather than
 * hiding a real one: the safer direction to be wrong in.
 */

/**
 * The vocabulary chains use for "not production". Each part is anchored as loosely as
 * it safely can be, which differs per word:
 *
 *  - `testnet` / `devnet` need no anchor at all. No English word contains either, and
 *    leaving both ends open is what matches the registry's "Core Blockchain Testnet2"
 *    (a trailing boundary fails before a digit) and "LaTestnet" (a leading one fails
 *    mid-word).
 *  - `test` must be anchored at the front, or it fires inside "latest", "greatest",
 *    "attestation". Open at the end so "Testnet2" still matches.
 *  - The rest are whole words — staging, local, private and alpha deployments. Bounded
 *    both ends because they are ordinary enough to appear inside real chain names.
 *
 * Deliberately absent: `subnet`, `mixnet`, `conet`, `tenet`. Those read as testnet
 * vocabulary but name production chains — Avalanche subnets (ONIGIRI Subnet, Jono11
 * Subnet), Qitmeer's Mixnet, CONET Mainnet, Tenet Mainnet. The testnets among them say
 * so separately ("ONIGIRI Test Subnet", "CONET Sebolia Testnet") and are caught above.
 */
const TESTNET_WORDS = /testnet|devnet|\btest|\b(stagenet|localnet|privnet|alphanet)\b/i

/**
 * Testnet families that say it nowhere in prose. Word-bounded so they cannot fire from
 * inside an unrelated name.
 */
const TESTNET_FAMILIES =
  /\b(sepolia|goerli|holesky|kovan|rinkeby|ropsten|amoy|mumbai|fuji|chiado|alfajores|previewnet|moonbase|hoodi)\b/i

/**
 * True when the registry's naming identifies a chain as a testnet.
 *
 * @param naming.name Resolved display name, as produced by getNetworkName.
 * @param naming.title The registry's `title`, when the server had one to serve.
 */
export const isTestnet = ({ name, title }: { name: string; title?: string | null }): boolean => {
  const subject = `${name} ${title ?? ''}`
  return TESTNET_WORDS.test(subject) || TESTNET_FAMILIES.test(subject)
}
