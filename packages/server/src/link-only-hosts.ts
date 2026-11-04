/**
 * @module link-only-hosts
 * Hosts whose artwork this service must only ever link to, never copy.
 *
 * Most sources let this service store their images and make derivatives of
 * them — every resize this service serves is a derivative. DeBank is the
 * first source whose own terms forbid both keeping a copy and making a
 * derivative. Storing one of its images, even briefly on the way to a resize,
 * would be exactly what its terms refuse. The safe answer is to never fetch
 * the bytes at all: record the address, and send a caller straight to DeBank
 * for the picture.
 *
 * Matching is by hostname, not by a substring of the whole address. A
 * substring test would also match an address that merely mentions
 * `static.debank.com` somewhere else in it — inside a query parameter, or as
 * a redirect target embedded by an unrelated host — which is not the same
 * claim as "this address is served by DeBank".
 */

/** Hosts whose images are recorded by address only, and never downloaded. */
const LINK_ONLY_HOSTS: ReadonlySet<string> = new Set(['static.debank.com'])

/**
 * Whether an address is served by a host this service must only link to.
 *
 * A non-`http(s)` address (a relative submodule path, a `data:` uri) can
 * never name one of these hosts, so it is turned away before the address is
 * parsed at all. A malformed address is treated the same way rather than
 * thrown on — whether to fetch it is a question for the caller, not this
 * policy check.
 */
export const isLinkOnlyHost = (uri: string | null | undefined): boolean => {
  if (!uri) return false
  if (!uri.startsWith('http://') && !uri.startsWith('https://')) return false
  try {
    return LINK_ONLY_HOSTS.has(new URL(uri).hostname)
  } catch {
    return false
  }
}

/**
 * Address prefixes that name a link-only host, for a database that cannot run
 * `isLinkOnlyHost`. One per host and scheme, lower case, ending in the slash that
 * ends the host — so `static.debank.com.evil.example` cannot match.
 *
 * The list is derived from the same set `isLinkOnlyHost` reads, so a host added
 * there reaches every SQL predicate built from this list with no second edit.
 * Callers compare with `starts_with`, never `LIKE`, so a host that contains `_`
 * or `%` is matched literally rather than as a wildcard.
 */
export const linkOnlyUriPrefixes = (): string[] =>
  [...LINK_ONLY_HOSTS].flatMap((host) => [`https://${host}/`, `http://${host}/`])
