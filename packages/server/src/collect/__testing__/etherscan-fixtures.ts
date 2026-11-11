/**
 * Etherscan strings shared by the collector's tests.
 *
 * Both refusals are the exact text measured against the live API on 2026-11-11 with a free key,
 * so a test that uses them proves the code reads what Etherscan really sends.
 */

/** `module=token&action=tokeninfo` (also `tokenholdercount` and `topholders`) on a free key. */
export const PRO_REFUSAL =
  'Sorry, it looks like you are trying to access an API Pro endpoint. Contact us to upgrade to API Pro.'

/** Any call on a chain the free plan does not cover, such as chain 56 or 8453. */
export const CHAIN_REFUSAL =
  'Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.'

/** The envelope Etherscan sends around a refusal. */
export const refusalBody = (result: string) => ({ status: '0', message: 'NOTOK', result })
