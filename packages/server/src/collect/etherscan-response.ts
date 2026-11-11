/**
 * @module collect/etherscan-response
 *
 * Pure reading of Etherscan API V2 answers. Nothing here touches the network, so every rule
 * can be tested with the exact strings Etherscan sends.
 *
 * Etherscan answers every request with HTTP 200 and a JSON envelope
 * `{ status: '1' | '0', message, result }`. A refusal is not an HTTP error: it is `status`
 * `'0'` with the reason in `message` or in `result` (a string instead of the data). So the
 * only way to tell "this key cannot call that endpoint" from "that token does not exist" is
 * to read the text, which is what {@link classifyEtherscanResponse} does.
 *
 * Documentation: https://docs.etherscan.io/common-error-messages and
 * https://docs.etherscan.io/api-reference/endpoint/tokeninfo
 */

/**
 * What an Etherscan answer means for the caller.
 *
 * - `ok`: the call worked and `result` holds data.
 * - `requires-pro`: the endpoint needs a paid plan ("API Pro"). Retrying cannot help.
 * - `chain-not-on-plan`: the plan does not cover this chain. Retrying cannot help.
 * - `invalid-key`: the key is missing, wrong or throttled for repeated misuse.
 * - `rate-limited`: too many calls (per second, or the shared daily pool). Retrying later can help.
 * - `other`: anything else, including "no data for this token" and network faults.
 */
export type EtherscanOutcome = 'ok' | 'requires-pro' | 'chain-not-on-plan' | 'invalid-key' | 'rate-limited' | 'other'

/** The outcome of one answer plus the text Etherscan gave, for logs and reports. */
export type EtherscanClassification = {
  outcome: EtherscanOutcome
  /** The refusal text Etherscan sent, or a short description when it sent none. Never holds the key. */
  detail: string
}

/**
 * Phrases that identify each refusal, matched against the lower-cased message and result text.
 * The order is the order of precedence: a plan refusal outranks a rate message, and so on.
 * Every phrase comes from a string Etherscan has sent (see the tests) or from
 * https://docs.etherscan.io/common-error-messages.
 */
const REFUSAL_PHRASES: readonly { outcome: Exclude<EtherscanOutcome, 'ok' | 'other'>; phrases: readonly string[] }[] = [
  // First, because the daily-quota message also ends "please upgrade to API Pro" and would
  // otherwise read as a plan refusal (seen 2026-11-11 on Celo and Linea). It resets daily.
  { outcome: 'rate-limited', phrases: ['community free api limit reached'] },
  { outcome: 'requires-pro', phrases: ['api pro endpoint', 'upgrade to api pro'] },
  { outcome: 'chain-not-on-plan', phrases: ['free api access is not supported for this chain'] },
  { outcome: 'invalid-key', phrases: ['invalid api key', 'missing/invalid api key'] },
  { outcome: 'rate-limited', phrases: ['rate limit', 'max calls per sec', 'community free api limit reached'] },
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The text of one envelope field, or an empty string when it is not text. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Decide what an Etherscan answer means.
 *
 * Success is `status` `'1'` (the API sends a string; a number is accepted too). Anything else is
 * matched against the known refusal phrases in `message` and in `result`. An answer that is not
 * an object, or that matches no phrase, is `other`, never `ok`: the caller must not treat an
 * unknown answer as permission.
 *
 * @param body The parsed JSON body of the response.
 * @returns The outcome and the text that explains it.
 */
export const classifyEtherscanResponse = (body: unknown): EtherscanClassification => {
  if (!isRecord(body)) return { outcome: 'other', detail: 'the response was not a JSON object' }
  if (String(body.status) === '1') return { outcome: 'ok', detail: textOf(body.message) || 'OK' }
  const message = textOf(body.message)
  const resultText = textOf(body.result)
  const haystack = `${message} ${resultText}`.toLowerCase()
  const refusal = REFUSAL_PHRASES.find(({ phrases }) => phrases.some((phrase) => haystack.includes(phrase)))
  const detail = resultText || message || 'the response carried no message'
  return { outcome: refusal?.outcome ?? 'other', detail }
}

/** Token metadata read from a `tokeninfo` answer. */
export type EtherscanTokenInfo = {
  address: string
  name: string
  symbol: string
  decimals: number
  /** An absolute `http` or `https` address for the logo, or null when Etherscan gave none. */
  logoURI: string | null
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * The logo address from the `image` field, or null.
 *
 * Etherscan names the field `image`, not `logo` (https://docs.etherscan.io/api-reference/endpoint/tokeninfo).
 * Only an absolute `http` or `https` address is kept. A relative path would need the explorer's own
 * host, which varies by chain, and guessing it would store the wrong picture or none.
 */
const readLogoAddress = (image: unknown): string | null => {
  const text = textOf(image).trim()
  return /^https?:\/\//i.test(text) ? text : null
}

/**
 * Read one token out of a `tokeninfo` `result` array.
 *
 * Returns null when the answer holds no ERC-20 token that can be stored: no record, no usable
 * name or symbol, a decimals value that is not a whole number from 0 to 255, or a token type
 * that is not ERC-20 (Etherscan answers `ERC721` and `ERC1155` for collections). The field
 * `divisor` is the number of decimals, despite its name.
 *
 * @param result The `result` member of an `ok` answer.
 */
export const parseTokenInfo = (result: unknown): EtherscanTokenInfo | null => {
  const [record] = Array.isArray(result) ? result : []
  if (!isRecord(record)) return null
  const address = textOf(record.contractAddress)
  const name = textOf(record.tokenName).trim()
  const symbol = textOf(record.symbol).trim()
  const decimals = Number(textOf(record.divisor) || Number.NaN)
  const tokenType = textOf(record.tokenType).toUpperCase()
  const isWholeDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
  const isFungible = tokenType === '' || tokenType === 'ERC20'
  if (!HEX_ADDRESS.test(address) || !name || !symbol || !isWholeDecimals || !isFungible) return null
  return { address: address.toLowerCase(), name, symbol, decimals, logoURI: readLogoAddress(record.image) }
}
