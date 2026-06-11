import * as viem from 'viem'

/**
 * Lowercase an EVM address to a canonical form. Non-EVM providedIds (Solana and Tron
 * base58, synthetic hashes, etc.) are case-sensitive and pass through unchanged — an
 * unconditional `.toLowerCase()` would corrupt them. The DB column is `citext` so this
 * isn't required for correctness, but storing a consistent form prevents duplicate
 * rows with different casing from accumulating when collectors disagree.
 *
 * Collectors should use this instead of `.toLowerCase()` whenever a provided id may
 * be non-EVM (user-submitted lists, multi-chain asset repositories).
 *
 * @param providedId - A token identifier: an EVM address or any other chain's id.
 * @returns The lowercased address when the input is an EVM address, otherwise the
 *   input unchanged. The generic parameter preserves the caller's string type: the
 *   pass-through case returns the value untouched, and the lowercase case only fires
 *   for hex addresses, which remain `0x${string}`.
 */
export const normalizeProvidedId = <T extends string>(providedId: T): T =>
  (viem.isAddress(providedId) ? providedId.toLowerCase() : providedId) as T

/**
 * Canonical casing for bridge home/foreign addresses: EIP-55 checksummed.
 *
 * NOTE the deliberate asymmetry with normalizeProvidedId (token ids are
 * lowercased): the bridge_id trigger hashes the stored address text
 * case-sensitively and was never migrated, and every existing bridge row was
 * inserted checksummed. Changing the canonical form would orphan those rows —
 * new inserts would hash to fresh bridge_ids with zeroed block checkpoints,
 * forcing full event-history re-scans. Non-EVM inputs pass through unchanged.
 *
 * @param address - A bridge contract address (EVM hex expected today).
 * @returns The EIP-55 checksummed form for EVM addresses, the input otherwise.
 */
export const canonicalBridgeAddress = <T extends string>(address: T): T =>
  (viem.isAddress(address) ? viem.getAddress(address) : address) as T
