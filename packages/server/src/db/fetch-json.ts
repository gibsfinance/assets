import { fetch } from '../fetch'

/**
 * @module db/fetch-json
 * The one place a collector's JSON request is made and judged.
 *
 * A bare `res.json()` turns every failure into a message about parsing
 * ("Unexpected token '<'") that names neither the address nor the answer. This
 * module reads the body as text first, so a refusal, an error page or a gateway
 * notice is reported with the address (secrets removed), the status, the content
 * type and the first bytes of what came back.
 */

/** Query parameter names whose values are never written to a log. */
const SENSITIVE_PARAMETER = /key|token|secret|auth|sig|pass|credential/i

/** How many characters of the response body an error message carries. */
const EXCERPT_LENGTH = 120

/**
 * Describes an address for a log line, with any credential removed: the user
 * name and password, and the value of every query parameter whose name suggests
 * a secret. An address that does not parse is not echoed back.
 *
 * @param input - The address.
 * @returns The address with credentials replaced by `redacted`.
 */
export const redactUrl = (input: string | URL): string => {
  const raw = String(input)
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    for (const name of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAMETER.test(name)) url.searchParams.set(name, 'redacted')
    }
    return url.toString()
  } catch {
    return '<unparseable url>'
  }
}

/**
 * Fetches an address (through the project's fetch, which adds a user agent and
 * understands `ipfs://`) and parses the answer as JSON. Throws an error that names
 * the address, the status and the content type, with the start of the body, when
 * the answer is not a success or is not JSON.
 *
 * @param input - The address.
 * @param init - Request options, as for `fetch`.
 * @returns The parsed body.
 */
export const fetchJSON = async <T>(input: string | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init)
  const body = await response.text()
  const received = `${redactUrl(input)} answered ${response.status} (content-type: ${response.headers.get('content-type') ?? 'none'})`
  const excerpt = body.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH)
  if (!response.ok) throw new Error(`${received}: ${excerpt}`)
  try {
    return JSON.parse(body) as T
  } catch (cause) {
    throw new Error(`${received} with a body that is not JSON: ${excerpt}`, { cause })
  }
}
