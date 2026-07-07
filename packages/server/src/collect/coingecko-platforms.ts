import { isAddress } from 'viem'

/**
 * CoinGecko keys every chain by a platform id (a slug like 'solana' or 'tron')
 * and, for Ethereum-Virtual-Machine chains, a numeric `chain_identifier`. Non-EVM
 * platforms report `chain_identifier: null`, so they cannot be turned into an
 * eip155 network the way EVM platforms are. This map redirects the supported non-EVM
 * platforms to their Satoshi-Labs-Improvement-Proposal-44 CAIP-2 identifiers, keeping
 * them in step with the DexScreener and Trust Wallet collectors.
 *
 * Sui (platform id 'sui', coin type 784) is intentionally absent until the sui
 * namespace joins the closed non-EVM set.
 */
export const COINGECKO_NON_EVM_PLATFORMS: Record<string, { chainIdentifier: string; type: string }> = {
  solana: { chainIdentifier: 'solana-501', type: 'solana' },
  tron: { chainIdentifier: 'tvm-195', type: 'tvm' },
}

/** A resolved CoinGecko platform ready to become a gib.show network. */
export type ResolvedPlatform = {
  /** CAIP-2 identifier passed to insertNetworkFromChainId (eip155-56, solana-501). */
  chainIdentifier: string
  /** network.type — 'evm' for Ethereum-Virtual-Machine chains, the namespace otherwise. */
  type: string
  /** Stable per-chain list key. EVM keeps its bare numeric id for continuity. */
  listKey: string
  /** Whether addresses on this platform are Ethereum-Virtual-Machine hex addresses. */
  evm: boolean
}

/**
 * Resolve a CoinGecko platform into a gib.show network descriptor. Supported non-EVM
 * platforms resolve to their CAIP-2 identifier; EVM platforms resolve from their
 * numeric `chain_identifier`; anything else (a null-identifier platform we do not yet
 * support) returns null and is skipped.
 */
export const resolvePlatform = (platformId: string, chainIdentifier: number | null): ResolvedPlatform | null => {
  const nonEvm = COINGECKO_NON_EVM_PLATFORMS[platformId]
  if (nonEvm) {
    return { chainIdentifier: nonEvm.chainIdentifier, type: nonEvm.type, listKey: nonEvm.chainIdentifier, evm: false }
  }
  if (typeof chainIdentifier === 'number') {
    // EVM list keys stay bare-numeric ("56") to match how they were first written.
    return { chainIdentifier: `eip155-${chainIdentifier}`, type: 'evm', listKey: String(chainIdentifier), evm: true }
  }
  return null
}

/**
 * Base58 shape check for non-EVM token ids (Solana mints, Tron addresses). The base58
 * alphabet excludes 0, O, I and l; the length window covers Solana (32–44) and Tron
 * (34). The bound only rejects obvious garbage so a malformed id is dropped at
 * collection rather than stored as an unservable row.
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{25,64}$/

/**
 * Validate a token id for a resolved platform. EVM platforms require a hex address;
 * non-EVM platforms require a plausible base58 id.
 */
export const isValidPlatformAddress = (platform: ResolvedPlatform, address: string): boolean =>
  platform.evm ? isAddress(address) : BASE58.test(address)

/**
 * Normalize a token id for storage. EVM addresses lowercase (case-insensitive);
 * non-EVM base58 ids are case-significant and preserved verbatim.
 */
export const normalizePlatformAddress = (platform: ResolvedPlatform, address: string): string =>
  platform.evm ? address.toLowerCase() : address
