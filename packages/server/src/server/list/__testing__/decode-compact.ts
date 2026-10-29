import type { DefaultBody, DefaultToken } from '../compact'

/**
 * Decode a compact body the way a client would, using only what the body itself
 * declares. If this needs anything from the encoder's source, the `fields` and
 * `sources` properties are not enough to decode and the format is under-documented.
 */
export const decodeCompactBody = (text: string): DefaultBody => {
  const compact = JSON.parse(text) as {
    chainId: number
    chainIdentifier: string
    total: number
    fields: string[]
    sources: string[]
    tokens: unknown[][]
  }
  return {
    chainId: compact.chainId,
    chainIdentifier: compact.chainIdentifier,
    total: compact.total,
    tokens: compact.tokens.map((row) => {
      const token: Record<string, unknown> = { chainId: compact.chainId, chainIdentifier: compact.chainIdentifier }
      compact.fields.forEach((field, position) => {
        token[field] = row[position]
      })
      const indexes = token.sources as number[]
      if (indexes.length === 0) delete token.sources
      else token.sources = indexes.map((index) => compact.sources[index])
      return token as unknown as DefaultToken
    }),
  }
}
