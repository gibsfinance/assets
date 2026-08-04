/**
 * Tests for the pure values behind token search.
 *
 * `escapeLikePattern` is the reason this module is tested directly rather than only
 * through the handler. It is the boundary between a term someone typed and pattern
 * syntax the database acts on, and every case below is a term that would otherwise mean
 * something the caller did not say — most of them expensively.
 */
import { describe, it, expect } from 'vitest'
import { escapeLikePattern, SEARCH_CANDIDATE_CAP } from './search'

describe('escapeLikePattern', () => {
  it('leaves an ordinary term untouched', () => {
    expect(escapeLikePattern('usdc')).toBe('usdc')
  })

  it('escapes the multi-character wildcard', () => {
    // Unescaped, `%` wrapped in the handler's own `%…%` becomes `%%%`, which matches
    // every token on every chain — the most expensive answer the table can produce,
    // reachable by anyone from a one-character request.
    expect(escapeLikePattern('%')).toBe('\\%')
  })

  it('escapes the single-character wildcard', () => {
    expect(escapeLikePattern('_')).toBe('\\_')
  })

  it('escapes a literal backslash', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })

  it('does not let an escaped backslash consume the escape of the character after it', () => {
    // The failure this pins: escaping `\` and `%` in separate passes turns `\%` into
    // `\\%` on the first pass and `\\\%` on the second — a literal backslash followed by
    // an *unescaped* wildcard. One pass over a character class cannot reorder that way.
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%')
  })

  it('escapes every occurrence, not only the first', () => {
    expect(escapeLikePattern('%a%b%')).toBe('\\%a\\%b\\%')
  })

  it('leaves characters that are not pattern syntax alone', () => {
    // Quotes, brackets and the like are handled by parameterization, not by escaping —
    // widening this to punctuation generally would corrupt terms that legitimately
    // contain it. Token names contain all of this.
    const term = "o'brien [v2] 100% #1"
    expect(escapeLikePattern(term)).toBe("o'brien [v2] 100\\% #1")
  })

  it('handles an empty term without producing pattern syntax', () => {
    expect(escapeLikePattern('')).toBe('')
  })
})

describe('SEARCH_CANDIDATE_CAP', () => {
  it('is a positive integer the handler can clamp against', () => {
    // Guards the arithmetic rather than the number: the handler computes `limit + 1` from
    // this and passes it as a SQL LIMIT, so a non-integer or a zero would either error in
    // Postgres or silently return nothing.
    expect(Number.isInteger(SEARCH_CANDIDATE_CAP)).toBe(true)
    expect(SEARCH_CANDIDATE_CAP).toBeGreaterThan(0)
  })
})
