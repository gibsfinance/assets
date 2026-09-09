/**
 * @module debridge-parse
 * Reading deBridge's routable token catalogue.
 *
 * Two endpoints, both unauthenticated. `supported-chains-info` names the chains,
 * and `token-list?chainId=` returns one chain's tokens keyed by address. Neither
 * token entry carries a chain of its own, so the chain comes from whichever
 * request produced it.
 *
 * **The catalogue is keyed by deBridge's own chain numbers, which are not chain
 * ids.** HyperEVM is 100000022 there, Tron 100000026, Solana 7565164. Reading
 * `chainId` and filing tokens under it would invent networks like
 * `eip155-100000022` and hang real tokens on them. The field that means what
 * this service means by a chain is `originalChainId`, and every one of the
 * seventeen was checked against the chain registry: HyperEVM resolves to 999,
 * Tron to 728126428, Monad to 143, MegaETH to 4326. That check is the whole
 * reason this module reads one field and ignores the other.
 */
import { readToken, countRejection, asRecord, type AggregatorToken, type ParsedCatalogue } from './aggregator-parse'

/**
 * Chains deBridge settles that are not Ethereum Virtual Machine chains.
 *
 * Listed by their real identifiers rather than by deBridge's. Solana's number
 * is not a chain id in any sense this service recognizes, and Tron's is the one
 * the database refuses by name — it belongs at `tvm-195`, and a collector that
 * offered it would be told so on every run. Both are excluded here so the
 * question never reaches the database.
 */
export const NON_EVM_CHAIN_IDS: ReadonlySet<number> = new Set([
  7565164, // Solana
  728126428, // Tron
])

/** One chain deBridge settles, named by the number this service means by a chain. */
export interface DebridgeChain {
  /** The real chain id, read from `originalChainId`. */
  chainId: number
  /** deBridge's own number, which the token-list request is keyed by. */
  requestId: number
  name: string
}

/**
 * Read the chain list, keeping the Ethereum Virtual Machine chains.
 *
 * Both numbers are carried out of here on purpose: `requestId` is what the token
 * endpoint answers to, and `chainId` is what the tokens are filed under. Keeping
 * only one of them is how a caller ends up asking for the wrong chain's tokens
 * or filing the right ones in the wrong place.
 */
export const parseChainList = (raw: unknown): DebridgeChain[] => {
  const body = asRecord(raw)
  const chains = body?.chains
  if (!Array.isArray(chains)) return []

  const parsed: DebridgeChain[] = []
  const seen = new Set<number>()
  for (const entry of chains) {
    const record = asRecord(entry)
    if (!record) continue
    const requestId = record.chainId
    const chainId = record.originalChainId
    if (typeof requestId !== 'number' || !Number.isInteger(requestId)) continue
    if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId < 1) continue
    if (NON_EVM_CHAIN_IDS.has(chainId)) continue
    // A repeated chain would fetch and file the same tokens twice.
    if (seen.has(chainId)) continue
    seen.add(chainId)
    parsed.push({
      chainId,
      requestId,
      name: typeof record.chainName === 'string' ? record.chainName : String(chainId),
    })
  }
  return parsed
}

/**
 * Read one chain's tokens.
 *
 * The response is an object keyed by address, and each value repeats the address
 * in a field. The field is used rather than the key: they agree today across
 * every chain checked, and where a source states the same fact twice the one
 * inside the record is the one the rest of the record describes.
 *
 * @param raw - The parsed `token-list` body for one chain.
 * @param chainId - The real chain id these tokens belong to, from `parseChainList`.
 */
export const parseChainTokens = (raw: unknown, chainId: number): ParsedCatalogue => {
  const body = asRecord(raw)
  const tokens = asRecord(body?.tokens)
  if (!tokens) return { tokens: [], rejected: {} }

  const parsed: AggregatorToken[] = []
  const rejected: Record<string, number> = {}

  for (const entry of Object.values(tokens)) {
    const record = asRecord(entry)
    if (!record) {
      countRejection(rejected, 'not an object')
      continue
    }
    const read = readToken({
      chainId,
      address: record.address,
      name: record.name,
      symbol: record.symbol,
      decimals: record.decimals,
      logoURI: record.logoURI,
    })
    if ('reason' in read) {
      countRejection(rejected, read.reason)
      continue
    }
    parsed.push(read)
  }

  return { tokens: parsed, rejected }
}
