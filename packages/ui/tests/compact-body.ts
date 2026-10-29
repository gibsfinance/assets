/**
 * Test scaffolding: encode default-format tokens as the server's compact body.
 * Mirrors `toCompactBody` in packages/server/src/server/list/compact.ts, limited
 * to the columns the interface requests.
 */
import { COMPACT_TOKEN_FIELDS, type CompactTokensResponse } from '../src/lib/utils/compact-tokens'

/** One token as a default-format body carries it. */
export interface DefaultFormatToken {
  address: string
  name: string
  symbol: string
  decimals: number
  sources?: string[]
}

/** Encode tokens as the compact body for a chain. `total` defaults to the token count. */
export function compactBody(
  chainId: number,
  tokens: readonly DefaultFormatToken[],
  options: { total?: number } = {},
): CompactTokensResponse {
  const sources: string[] = []
  const indexOf = (source: string) => {
    const known = sources.indexOf(source)
    if (known !== -1) return known
    sources.push(source)
    return sources.length - 1
  }
  return {
    chainId,
    total: options.total ?? tokens.length,
    format: 'compact',
    fields: COMPACT_TOKEN_FIELDS.split(','),
    sources,
    tokens: tokens.map((token) => [
      token.address,
      token.name,
      token.symbol,
      token.decimals,
      (token.sources ?? []).map(indexOf),
    ]),
  }
}
