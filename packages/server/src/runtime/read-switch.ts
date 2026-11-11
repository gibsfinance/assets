/** Spellings of an off switch, compared after trimming and lower-casing. */
const OFF_SPELLINGS: ReadonlySet<string> = new Set(['false', '0', 'no', 'off'])

/** Spellings of an on switch, compared after trimming and lower-casing. */
const ON_SPELLINGS: ReadonlySet<string> = new Set(['true', '1', 'yes', 'on'])

/**
 * Reads an on or off setting from its text, such as an environment variable.
 *
 * Only a plain spelling of on (`true`, `1`, `yes`, `on`) or off (`false`, `0`, `no`, `off`) is
 * believed, in any letter case. An unset, empty or unrecognised value is not an error: the
 * caller's default is returned, so a typo can neither stop the process from starting nor flip
 * a switch the operator did not mean to touch.
 *
 * @param rawValue The setting's text, as `process.env` gives it.
 * @param fallback The value to use when the text is not a recognised spelling.
 * @returns True or false.
 */
export function readSwitch(rawValue: string | undefined, fallback: boolean): boolean {
  const spelling = rawValue?.trim().toLowerCase() ?? ''
  if (ON_SPELLINGS.has(spelling)) return true
  if (OFF_SPELLINGS.has(spelling)) return false
  return fallback
}
