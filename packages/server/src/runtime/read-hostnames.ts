/**
 * Reads a list of host names from the text of a setting, such as an environment variable.
 *
 * The names are separated by commas. Spaces around a name are dropped, names are lower-cased
 * (host names do not depend on case), and empty entries are ignored. An unset or empty setting
 * gives an empty list, which means the feature that reads it is off.
 *
 * @param rawValue The setting's text, as `process.env` gives it.
 * @returns The host names, in the order written.
 */
export function readHostnames(rawValue: string | undefined): string[] {
  return (rawValue ?? '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname.length > 0)
}
