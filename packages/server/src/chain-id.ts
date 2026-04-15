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
