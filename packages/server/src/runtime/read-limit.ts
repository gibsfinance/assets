/**
 * Reads a whole number of at least one from the text of a setting, such as an environment
 * variable.
 *
 * An unset, empty, fractional, zero, negative or non-numeric value is not an error: the
 * caller's default is returned. A mistyped limit must never turn a limit off (zero often
 * means "unlimited") or stop the process from starting.
 *
 * @param rawValue The setting's text, as `process.env` gives it.
 * @param fallback The value to use when the text is not a whole number of at least one.
 * @returns The parsed number, or `fallback`.
 */
export function readLimit(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue)
  const isUsable = rawValue !== undefined && rawValue.trim() !== '' && Number.isInteger(parsed) && parsed >= 1
  return isUsable ? parsed : fallback
}
