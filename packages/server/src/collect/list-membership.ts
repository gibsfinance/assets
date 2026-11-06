/**
 * @module collect/list-membership
 *
 * Pure helpers for collectors that publish a new list version when a list's membership
 * changes. Kept free of database access so the rules are testable on their own.
 */

/** The three numbers that order the versions of one list. */
export type ListVersionNumbers = { major: number; minor: number; patch: number }

/** The largest value a Postgres `smallint` version column holds. */
export const SMALLINT_MAX = 32767

/**
 * The version that follows `version`. Increments the patch number and carries into the
 * minor and major numbers when a `smallint` column would overflow, so a list that changes
 * on every run keeps ordering correctly instead of failing the insert years from now.
 */
export const nextListVersion = ({ major, minor, patch }: ListVersionNumbers): ListVersionNumbers => {
  if (patch < SMALLINT_MAX) return { major, minor, patch: patch + 1 }
  if (minor < SMALLINT_MAX) return { major, minor: minor + 1, patch: 0 }
  return { major: major + 1, minor: 0, patch: 0 }
}

/**
 * Whether two collections of token identifiers hold exactly the same members. Order and
 * duplicates do not matter: membership is a set, and a reordered feed is not a change.
 */
export const sameMembership = (published: Iterable<string>, collected: Iterable<string>): boolean => {
  const publishedSet = new Set(published)
  const collectedSet = new Set(collected)
  if (publishedSet.size !== collectedSet.size) return false
  for (const member of collectedSet) {
    if (!publishedSet.has(member)) return false
  }
  return true
}
