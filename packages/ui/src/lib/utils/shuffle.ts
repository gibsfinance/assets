/** Produces numbers from zero up to but not including one, like `Math.random`. */
export type RandomSource = () => number

/**
 * Return the items in a random order, leaving the caller's array alone.
 *
 * This is the Fisher and Yates shuffle: walk from the end, and swap each item
 * with one drawn from the part not yet visited. Drawing from the whole array
 * instead — the one-character change of picking `j` from `0..length` rather than
 * `0..i` — still looks shuffled and is measurably biased, so the range is the
 * thing a test has to hold.
 *
 * @param items - What to shuffle. Not modified.
 * @param random - Source of randomness. Defaults to `Math.random`. Passing one
 *   in is what lets a test name the resulting order instead of asserting only
 *   that the length did not change.
 */
export const shuffle = <T>(items: readonly T[], random: RandomSource = Math.random): T[] => {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
