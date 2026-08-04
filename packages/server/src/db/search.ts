/**
 * @module db/search
 * Pure values behind the token search query.
 *
 * Split out of `db/index.ts` rather than living beside `searchTokens` because both are
 * needed by callers that mock the data layer wholesale. A test that stubs `../../db` has
 * no way to reach a constant defined inside it, and a mock that guesses the number
 * instead passes while production clamps to a different one. Neither of these touches a
 * database, so nothing is lost by moving them out and the handler can import the real
 * values through the same mock.
 */

/**
 * Escape a user-supplied search term for use inside an ILIKE pattern.
 *
 * `%`, `_` and `\` are pattern syntax, not text. Left alone, a search for `%` matches
 * every token on every chain — the single most expensive query the table can answer,
 * available to anyone, from a one-character request. `_` is the same problem one row at
 * a time. The backslash goes first, via a single pass over the character class, so it
 * cannot re-escape the escapes added after it.
 *
 * Postgres reads `\` as the pattern escape by default, so no ESCAPE clause is needed.
 */
export const escapeLikePattern = (term: string): string => term.replace(/[\\%_]/g, '\\$&')

/**
 * The most tokens a single search may return, and the ceiling `?limit=` is clamped to.
 *
 * A bound is needed because the second half of the query is per-candidate: without one, a
 * two-character term matching fifty-seven thousand tokens would resolve the best list
 * entry for every one of them before discarding all but the requested page, and cost the
 * same as asking for the whole table.
 *
 * What makes a bound safe rather than arbitrary is that `searchTokens` scores candidates
 * — by relevance tier and by how many lists carry the token — before it cuts. What falls
 * off the end is the least relevant match, not whichever row the planner reached first.
 * Raising this is cheap; the reason not to is that nobody scrolls a thousand results.
 */
export const SEARCH_CANDIDATE_CAP = 1000
