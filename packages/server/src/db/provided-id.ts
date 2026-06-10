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
