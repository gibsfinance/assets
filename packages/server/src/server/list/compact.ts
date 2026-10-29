/**
 * @module list/compact
 * The compact encoding of a chain token list.
 *
 * The default body repeats every source name on every token and every key on every
 * row. For Ethereum that is 6.06 MB, and the interface parses it on the main thread.
 * The compact body sends each source name once and each token as a positional array.
 * Measured on the live Ethereum body: 3.17 MB raw against 6.06 MB, and 1.23 MB brotli
 * against 1.29 MB.
 *
 * `logoURI` stays whole. Shortening it to the hash after `/image/direct/` saves another
 * 0.48 MB raw but only 14 KB (1.2 percent) of brotli, and 762 of the 16,641 Ethereum
 * logos live on other hosts, so a client would need a rule to tell a hash from a link.
 */
import createError from 'http-errors'

/** Body shapes `GET /list/tokens/:chainId` can answer with. */
export type TokensFormat = 'default' | 'compact'

/**
 * Names of the values in each compact token row, in order. The response repeats this
 * list in its `fields` property so a client can decode without a copy of this file.
 *
 * - `address`: lowercase address, or the case-significant identifier for non-EVM chains.
 * - `name`, `symbol`: strings; `decimals`: integer.
 * - `logoURI`: the complete image URL, exactly as the default body carries it.
 * - `sources`: array of integer indexes into the response's `sources` array. An empty
 *   array means the default body has no `sources` property for that token.
 */
export const COMPACT_FIELDS = ['address', 'name', 'symbol', 'decimals', 'logoURI', 'sources'] as const

/** One token as it appears in a default body. */
export interface DefaultToken {
  /** Present in the default body; the compact body leaves it to the response. */
  chainId?: number
  chainIdentifier?: string
  address: string
  name?: string
  symbol?: string
  decimals?: number
  logoURI: string
  sources?: string[]
}

/** A default body, as `buildTokensByChainResponse` writes it. */
export interface DefaultBody {
  chainId: number
  chainIdentifier: string
  total: number
  tokens: DefaultToken[]
}

/**
 * Read the `format` query value.
 *
 * @param raw - The raw `req.query.format`; absent means the default body.
 * @throws {createError.HttpError} 400 for any value other than `compact`. Repeated
 *   parameters arrive as arrays and are refused too, so no value forks the cache.
 */
export const parseTokensFormat = (raw: unknown): TokensFormat => {
  if (raw === undefined) return 'default'
  if (raw === 'compact') return 'compact'
  throw createError.BadRequest('invalid format — expected "compact", or omit the parameter for the default body')
}

/** Name of one value in a compact token row. */
export type CompactField = (typeof COMPACT_FIELDS)[number]

/**
 * Read the `fields` query value: a comma-separated subset of {@link COMPACT_FIELDS}.
 *
 * The result follows COMPACT_FIELDS order whatever order was requested, so every
 * spelling of one selection maps to one cache key and one body.
 *
 * @param raw - The raw `req.query.fields`; absent means every field.
 * @param format - The parsed format; `fields` selects within the compact rows only.
 * @throws {createError.HttpError} 400 when `format` is not compact, the value is not a
 *   single string, a name is unknown or repeated, or `address` is missing.
 */
export const parseCompactFields = (raw: unknown, format: TokensFormat): readonly CompactField[] => {
  if (raw === undefined) return COMPACT_FIELDS
  if (format !== 'compact') throw createError.BadRequest('fields is valid only with format=compact')
  if (typeof raw !== 'string') throw createError.BadRequest('fields must be one comma-separated list')
  const requested = raw.split(',')
  const unknown = requested.filter((name) => !(COMPACT_FIELDS as readonly string[]).includes(name))
  if (unknown.length > 0) {
    throw createError.BadRequest(
      `unknown fields: ${unknown.join(', ')} — expected a subset of ${COMPACT_FIELDS.join(',')}`,
    )
  }
  if (new Set(requested).size !== requested.length) throw createError.BadRequest('fields lists a name more than once')
  if (!requested.includes('address')) throw createError.BadRequest('fields must include address')
  return COMPACT_FIELDS.filter((name) => requested.includes(name))
}

/**
 * Re-encode a parsed default body as a serialized compact body. Token order and
 * `total` carry over unchanged.
 *
 * @param body - A default (or limited default) body.
 * @param fields - Fields to send, in COMPACT_FIELDS order (see {@link parseCompactFields}).
 *   When `sources` is not among them the body carries no top-level `sources` array.
 */
export const toCompactBody = (body: DefaultBody, fields: readonly CompactField[] = COMPACT_FIELDS): string => {
  const sourceIndexes = new Map<string, number>()
  const indexOf = (source: string): number => {
    const known = sourceIndexes.get(source)
    if (known !== undefined) return known
    sourceIndexes.set(source, sourceIndexes.size)
    return sourceIndexes.size - 1
  }
  const valueOf: Record<CompactField, (token: DefaultToken) => unknown> = {
    address: (token) => token.address,
    name: (token) => token.name,
    symbol: (token) => token.symbol,
    decimals: (token) => token.decimals,
    logoURI: (token) => token.logoURI,
    sources: (token) => (token.sources ?? []).map(indexOf),
  }
  const tokens = body.tokens.map((token) => fields.map((field) => valueOf[field](token)))
  return JSON.stringify({
    chainId: body.chainId,
    chainIdentifier: body.chainIdentifier,
    total: body.total,
    format: 'compact',
    fields,
    ...(fields.includes('sources') ? { sources: [...sourceIndexes.keys()] } : {}),
    tokens,
  })
}
