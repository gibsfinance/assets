/**
 * @module compact-tokens
 * Decoder for the compact chain token list.
 *
 * `GET /list/tokens/:chainId?format=compact&fields=...` sends each token as a
 * positional array and each source name once. The response names its columns in
 * `fields`, so this decoder finds every column by name and never by position.
 */

/** Columns the interface asks the server for, as the `fields` query value. */
export const COMPACT_TOKEN_FIELDS = 'address,name,symbol,decimals,sources'

/** The query string that selects the compact body with the columns above. */
export const COMPACT_TOKEN_QUERY = `format=compact&fields=${COMPACT_TOKEN_FIELDS}`

/** Columns a token row cannot be built without. */
const REQUIRED_FIELDS = ['address', 'name', 'symbol', 'decimals'] as const

/** A compact body as the server writes it. */
export interface CompactTokensResponse {
  chainId: number
  total: number
  format: 'compact'
  /** Column names, in the order each token row carries its values. */
  fields: string[]
  /** Source names, each once. Rows hold indexes into this array. */
  sources?: string[]
  tokens: unknown[][]
}

/** One decoded row. `sources` is empty when the default body had no `sources` for the token. */
export interface DecodedToken {
  address: string
  name: string
  symbol: string
  decimals: number
  sources: string[]
}

/**
 * Check that a parsed body is a compact list with every required column.
 *
 * The fetch calls this, so a refused body fails the query. Left to the decoder
 * alone, the error would surface while a component renders and unmount the page.
 *
 * @param response - The parsed JSON body.
 * @throws {Error} When `format` is not `compact` or a required column is absent.
 *   A server that ignored the query parameters would otherwise yield rows with
 *   empty names and no error to show for it.
 */
export function assertCompactTokens(response: CompactTokensResponse): void {
  if (response.format !== 'compact') {
    throw new Error(`expected a compact token list, got format "${String(response.format)}"`)
  }
  const missing = REQUIRED_FIELDS.filter((name) => !response.fields.includes(name))
  if (missing.length > 0) {
    throw new Error(`compact token list lacks required fields: ${missing.join(', ')}`)
  }
}

/**
 * Decode a compact body into plain rows.
 *
 * @param response - The parsed JSON body.
 * @throws {Error} See {@link assertCompactTokens}.
 */
export function decodeCompactTokens(response: CompactTokensResponse): DecodedToken[] {
  assertCompactTokens(response)
  const columnOf = (name: string) => response.fields.indexOf(name)
  const [address, name, symbol, decimals] = REQUIRED_FIELDS.map(columnOf)
  const sourcesColumn = columnOf('sources')
  const sourceNames = response.sources ?? []
  return response.tokens.map((row) => ({
    address: row[address] as string,
    name: row[name] as string,
    symbol: row[symbol] as string,
    decimals: row[decimals] as number,
    sources: sourcesColumn === -1 ? [] : (row[sourcesColumn] as number[]).map((index) => sourceNames[index]),
  }))
}
