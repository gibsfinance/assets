import type { LocalToken } from '../hooks/useLocalLists'

/**
 * Reads tokens out of a token list the user brought in.
 *
 * Three callers feed this, and none of them controls what arrives: a list
 * fetched from the server, a list fetched from any address the user types, and
 * a block of JSON pasted into a text box. Everything below therefore treats
 * every field as absent, malformed, or hostile until it is shown otherwise.
 *
 * The version this replaces read `Number(t.decimals || 18)`, which is the
 * mistake this module exists to keep from coming back. `||` asks whether a
 * value is falsy, and the question worth asking is whether the field was
 * supplied. Those differ on exactly the values a token list is most likely to
 * carry legitimately: a token with `decimals: 0` was silently rewritten to 18
 * decimals, which is not a display quirk but a factor of 10^18 applied to
 * every amount downstream.
 */

/** Fields carried by every token, with defaults for the ones a list may omit. */
const DEFAULT_CHAIN_ID = 1
const DEFAULT_DECIMALS = 18

/**
 * Largest decimals count a token can declare.
 *
 * The token standard holds decimals in an unsigned eight-bit field, so 255 is
 * the ceiling by definition. Nothing real comes close, but the number is the
 * exponent in `10 ** decimals`, so a value outside the range is not a display
 * quirk — it is an amount off by orders of magnitude.
 */
const MAX_DECIMALS = 255

/**
 * A finite number, or null.
 *
 * `Number('')` is 0 and `Number(null)` is 0, so a blank field would otherwise
 * read as a real zero. Only values that are already numbers, or strings with
 * something in them, are worth converting.
 */
const finiteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * A present value as text, or null.
 *
 * `String(undefined)` is the six-character word "undefined", and a token whose
 * address came back as the text "undefined" is worse than one with no address:
 * it looks like data.
 */
const presentText = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return null
}

/** A whole number of zero or more. Rejects negatives and fractions alike. */
const isWholeAtLeastZero = (value: number): boolean => Number.isInteger(value) && value >= 0

/** A token that could not be read, and why. */
export interface RejectedToken {
  /** Position in the incoming array, so the reader can find it. */
  index: number
  /** What was wrong, in words a user can act on. */
  reason: string
}

export interface TokenImportResult {
  tokens: LocalToken[]
  rejected: RejectedToken[]
}

/**
 * Convert one raw entry into a token.
 *
 * @param raw - One element of the incoming `tokens` array. Any shape at all.
 * @param index - Position in that array; becomes the token's sort order.
 * @returns The token, or a reason it could not be read.
 */
export const readToken = (raw: unknown, index: number): LocalToken | { reason: string } => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'not an object' }
  }
  const entry = raw as Record<string, unknown>

  const address = presentText(entry.address)?.trim()
  if (!address) return { reason: 'no address' }

  const chainId = finiteNumber(entry.chainId)
  if (chainId !== null && !isWholeAtLeastZero(chainId)) {
    return { reason: `chain identifier ${chainId} is not a whole number of zero or more` }
  }

  const decimals = finiteNumber(entry.decimals)
  // A malformed decimals count is refused rather than replaced with the default.
  // Substituting 18 for a value we cannot read is the same mistake as the `||`
  // this module was written to remove: it turns a broken token into a plausible
  // one, and the reader has no way to tell.
  if (decimals !== null && (!isWholeAtLeastZero(decimals) || decimals > MAX_DECIMALS)) {
    return { reason: `decimals ${decimals} is outside 0 to ${MAX_DECIMALS}` }
  }

  const imageUri = presentText(entry.logoURI)?.trim()

  return {
    chainId: chainId ?? DEFAULT_CHAIN_ID,
    address,
    name: presentText(entry.name) ?? '',
    symbol: presentText(entry.symbol) ?? '',
    decimals: decimals ?? DEFAULT_DECIMALS,
    // An empty string is not an image address; leaving the field off keeps the
    // token's own artwork resolution in play rather than pointing it at "".
    ...(imageUri ? { imageUri } : {}),
    order: index,
  }
}

/**
 * Read every token in a list, keeping the ones that parse.
 *
 * One unreadable entry must not lose the rest of the list — a user importing
 * four hundred tokens should get three hundred and ninety-nine and a note, not
 * an error. `order` counts kept tokens, so the survivors stay contiguous.
 *
 * @param raw - The incoming `tokens` value. Anything but an array reads as empty.
 */
export const readTokenList = (raw: unknown): TokenImportResult => {
  if (!Array.isArray(raw)) return { tokens: [], rejected: [] }

  const tokens: LocalToken[] = []
  const rejected: RejectedToken[] = []
  for (const [index, entry] of raw.entries()) {
    const read = readToken(entry, tokens.length)
    if ('reason' in read) {
      rejected.push({ index, reason: read.reason })
      continue
    }
    tokens.push(read)
  }
  return { tokens, rejected }
}
