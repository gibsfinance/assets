import { describe, it, expect } from 'vitest'
import { isRetryableResponse } from '@gibs/dexscreener'

/**
 * The collector traverses hundreds of token-pair requests per run. DexScreener's edge
 * intermittently returns a throttle status or an HTML challenge page mid-traversal; a
 * blind JSON.parse on that HTML used to throw and roll back the entire provider. These
 * cases must be classified as retryable so the run self-heals instead of aborting.
 */
describe('isRetryableResponse', () => {
  it('does not retry a healthy JSON response', () => {
    expect(isRetryableResponse(200, 'application/json; charset=utf-8')).toBe(false)
  })

  it('retries an HTML challenge page served with a 200 (the observed failure)', () => {
    expect(isRetryableResponse(200, 'text/html; charset=utf-8')).toBe(true)
  })

  it('retries when the content type is missing entirely', () => {
    expect(isRetryableResponse(200, null)).toBe(true)
  })

  it('retries explicit throttle and gateway statuses even if labelled JSON', () => {
    for (const status of [403, 408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableResponse(status, 'application/json')).toBe(true)
    }
  })

  it('does not retry a legitimate JSON error response (avoids hammering on real 404s)', () => {
    expect(isRetryableResponse(404, 'application/json')).toBe(false)
  })
})
