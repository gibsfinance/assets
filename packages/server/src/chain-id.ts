/**
 * CAIP-2 chain identifier utilities.
 * Uses dash instead of colon for URL safety: eip155-369 (not eip155:369).
 *
 * Zero dependencies — safe to import anywhere.
 */

const ASSET_CHAIN = '0'
const ASSET_PREFIX = 'asset'
const EVM_PREFIX = 'eip155'

/** Convert a bare numeric chain ID or existing CAIP-2 string to canonical CAIP-2 format. */
export function toCAIP2(input: string): string {
  if (input.includes('-')) return input // already CAIP-2
  if (input === ASSET_CHAIN) return `${ASSET_PREFIX}-${ASSET_CHAIN}`
  return `${EVM_PREFIX}-${input}`
}

/** Extract the bare reference from a CAIP-2 string (for DB queries against numeric column). */
export function fromCAIP2(input: string): string {
  const dashIndex = input.indexOf('-')
  if (dashIndex === -1) return input // bare number passthrough
  return input.slice(dashIndex + 1)
}

/** Extract the namespace from a CAIP-2 string (eip155, asset, solana, etc.). */
export function namespaceOf(input: string): string {
  const dashIndex = input.indexOf('-')
  if (dashIndex === -1) return EVM_PREFIX // bare number → assume EVM
  return input.slice(0, dashIndex)
}

/** Check if the input is a bare numeric chain ID (not yet CAIP-2). */
export function isBareNumeric(input: string): boolean {
  return /^\d+$/.test(input)
}

/**
 * Namespaces for non-Ethereum-Virtual-Machine chains. Each is stored with
 * network.type equal to the namespace string itself, whereas eip155 chains use
 * type 'evm' and the asset-0 network uses type 'evm' as well (legacy). Keeping
 * this set explicit is what preserves every existing network_id hash.
 */
export const NON_EVM_NAMESPACES: ReadonlySet<string> = new Set([
  'bip122',
  'solana',
  'monero',
  'cardano',
  'memo',
  'tvm',
  'ton',
  'cosmos',
  'aptos',
  'sui',
])

/**
 * Map a chain-id namespace to the value stored in network.type. Only the
 * non-Ethereum-Virtual-Machine namespaces map to themselves; eip155, asset, and
 * bare numeric inputs all resolve to 'evm', matching how existing rows were
 * written so their network_id hashes never move.
 */
export const namespaceToNetworkType = (namespace: string): string =>
  NON_EVM_NAMESPACES.has(namespace) ? namespace : 'evm'

/**
 * Check whether a chain id (bare or prefixed) is syntactically servable.
 * Stored networks carry eip155-<number>, asset-0, or one of the
 * non-Ethereum-Virtual-Machine namespaces paired with a numeric reference
 * (see insertNetworkFromChainId), so anything else can never match a row —
 * callers should reject it with 400 instead of returning an empty 200.
 */
export function isValidChainId(input: string): boolean {
  const canonical = toCAIP2(input)
  if (canonical === `${ASSET_PREFIX}-${ASSET_CHAIN}`) return true
  const namespace = namespaceOf(canonical)
  if (namespace !== EVM_PREFIX && !NON_EVM_NAMESPACES.has(namespace)) return false
  return isBareNumeric(fromCAIP2(canonical))
}
