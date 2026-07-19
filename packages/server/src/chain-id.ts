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
  'near',
  'polkadot',
  'algorand',
  'fil',
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
 * The network.type a chain id must carry, derived purely from its namespace:
 * eip155 / asset / bare-numeric all resolve to 'evm', and each non-EVM
 * namespace resolves to itself. This is the single source of truth that pairs
 * an identifier with its type, so a stored row can never disagree with itself
 * (an eip155-<n> row typed 'btc' or 'tvm' is definitionally corrupt).
 */
export const expectedNetworkType = (chainId: string): string => namespaceToNetworkType(namespaceOf(toCAIP2(chainId)))

/**
 * Reserved network.type used only by integration-test fixtures to seed
 * throwaway networks whose network_id hash cannot collide with a real 'evm' row
 * of the same numeric chain id. Production collectors never write it. The
 * insertNetworkFromChainId guard lets this one value through so fixtures stay
 * isolated, while every real type/namespace mismatch (a 'btc'- or 'tvm'-typed
 * eip155 row) is still rejected.
 */
export const TEST_NETWORK_TYPE = 'test'

/**
 * Numeric chain references that upstream token lists publish as bare numbers even
 * though the chain is not Ethereum-Virtual-Machine based. toCAIP2 would prefix each
 * 'eip155-<n>' — the wrong namespace — so they must be collected under their real
 * coin-type id instead:
 *   501000101  Solana (bridged list reference)  -> solana-501
 *   728126428  Tron (native eip155-style id)    -> tvm-195
 * The dedicated collectors already file these chains under the correct id, so the
 * eip155 forms are duplicates. isFakedEvmReference lets insertNetworkFromChainId
 * refuse them, so a generic list collector that echoes the raw number cannot
 * resurrect the husks that migrations 0006–0008 removed.
 *
 * DexScreener's 900 (Solana) and TrustWallet's 1000 (Tron) are deliberately NOT
 * listed. Those are provider-internal handles, not chain ids, and each collector
 * already resolves them to a CAIP-2 identifier before insert — dexscreener passes
 * `chain.caip2 ?? chain.id`, trustwallet maps tron to tvm-195 — so neither number
 * ever reaches this funnel. Banning them globally only rejected the real EVM chains
 * that own those ids in the ethereum-lists registry: 900 is Garizon Testnet Stage0
 * and 1000 is GTON Mainnet.
 */
export const FAKED_EVM_REFERENCES: ReadonlySet<string> = new Set(['501000101', '728126428'])

/** True when a chain id normalizes to one of the faked non-EVM eip155 references. */
export const isFakedEvmReference = (chainId: string): boolean => {
  const canonical = toCAIP2(chainId)
  return namespaceOf(canonical) === EVM_PREFIX && FAKED_EVM_REFERENCES.has(fromCAIP2(canonical))
}

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

/** Outcome of pairing a requested chain id with the identifiers actually stored. */
export type ChainIdResolution = { status: 'resolved'; chainId: string } | { status: 'ambiguous'; candidates: string[] }

/** A stored network sharing the requested numeric reference, and whether it holds tokens. */
export type StoredChainCandidate = { chainId: string; hasTokens: boolean }

/**
 * Resolve a requested chain id against the identifiers a chain reference actually
 * has rows under.
 *
 * A bare number carries no namespace, and `toCAIP2` assumes eip155 — correct when
 * every stored network was an EVM chain, wrong once Solana and Tron arrived under
 * `solana-501` and `tvm-195`. `/stats` publishes the bare number alongside the real
 * identifier, so feeding its own output back into a lookup asked for `eip155-501`,
 * matched nothing, and answered 200 with an empty list while `/stats` reported
 * thousands of tokens.
 *
 * Resolution follows the tokens, not merely the namespace. A network row can exist
 * with nothing behind it — the dev database carries an empty `eip155-501` beside the
 * real `solana-501`, and migration 0008 deletes four more such phantoms — so a rule
 * that preferred eip155 on sight would resolve to the empty row and reproduce the
 * very bug it fixes.
 *
 * Rules, in order:
 *   - An explicit namespace is an assertion; it passes through unchanged, even when
 *     it matches nothing. Redirecting it would answer a question nobody asked.
 *   - Among candidates holding tokens, eip155 wins, so `/list/tokens/1` keeps meaning
 *     Ethereum forever no matter which other chains share the number.
 *   - A lone populated non-EVM match resolves to that namespace — the fix.
 *   - Several populated matches and no eip155 is genuinely ambiguous; say so rather
 *     than serve one chain's tokens under another's name.
 *   - With nothing populated, a lone candidate is still named truthfully; otherwise
 *     fall back to eip155, preserving the empty-200 contract for a chain whose first
 *     token has yet to be collected.
 *
 * @param input Requested chain id, bare (`501`) or namespaced (`solana-501`).
 * @param storedCandidates Stored networks sharing the input's numeric reference.
 */
export function resolveChainIdAgainstStored(
  input: string,
  storedCandidates: readonly StoredChainCandidate[],
): ChainIdResolution {
  const canonical = toCAIP2(input)
  if (!isBareNumeric(input)) return { status: 'resolved', chainId: canonical }
  if (canonical === `${ASSET_PREFIX}-${ASSET_CHAIN}`) return { status: 'resolved', chainId: canonical }

  const reference = fromCAIP2(canonical)
  const matches = storedCandidates.filter((candidate) => fromCAIP2(candidate.chainId) === reference)
  const populated = matches.filter((candidate) => candidate.hasTokens)

  if (populated.length) {
    if (populated.some((candidate) => candidate.chainId === canonical)) {
      return { status: 'resolved', chainId: canonical }
    }
    if (populated.length === 1) return { status: 'resolved', chainId: populated[0].chainId }
    return { status: 'ambiguous', candidates: populated.map((candidate) => candidate.chainId).sort() }
  }

  if (matches.length === 1) return { status: 'resolved', chainId: matches[0].chainId }
  return { status: 'resolved', chainId: canonical }
}
