/**
 * @module cache-refresh
 * Shared decoding of the administrative `?refresh=1` query parameter.
 *
 * Two independent cache layers sit in front of these responses — the process-local
 * memo from `cacheResult` and the `cache_request` table, which survives restarts.
 * Neither can be cleared by redeploying, so verifying a deploy otherwise meant
 * waiting out a time-to-live measured in hours. This parameter is the escape hatch.
 *
 * It is admin-gated because every refresh rebuilds a response the caches exist to
 * avoid rebuilding — an open parameter would be a denial of service lever, since
 * anyone could force the expensive per-chain token query on every request.
 *
 * Deliberately pure and dependency-light: it decides nothing about how the caches
 * are rebuilt, only whether a refresh was asked for and whether it is allowed.
 */
import { isAuthorizedAdmin } from './admin-auth'

/**
 * Query shape for routes that accept the refresh parameter. `unknown` because the
 * value is client-controlled and is validated inside `refreshRequest`, not at the type level.
 */
export type RefreshQuery = { refresh?: unknown }

/** Query values that mean "rebuild the caches". Anything else is not a refresh request. */
const REFRESH_VALUES = new Set(['1', 'true'])

/**
 * Was a cache refresh requested, and is the caller allowed to have one?
 *
 * `authorized` is only meaningful when `requested` is true; callers that did not ask
 * for a refresh must keep their existing behaviour untouched.
 *
 * @param options.refreshParam - The raw `refresh` query value, unvalidated.
 * @param options.authorizationHeader - The incoming Authorization header, if any.
 * @param options.adminToken - The configured admin token; absent means nothing is authorized.
 */
export const refreshRequest = (options: {
  refreshParam: unknown
  authorizationHeader?: string
  adminToken?: string
}): { requested: boolean; authorized: boolean } => {
  const { refreshParam, authorizationHeader, adminToken } = options
  // Express hands back an array when the parameter repeats (?refresh=1&refresh=1).
  // Read the last value so a repeat behaves like the single form rather than
  // silently falling through as "not requested".
  const raw = Array.isArray(refreshParam) ? refreshParam[refreshParam.length - 1] : refreshParam
  if (typeof raw !== 'string') return { requested: false, authorized: false }
  const requested = REFRESH_VALUES.has(raw.trim().toLowerCase())
  if (!requested) return { requested: false, authorized: false }
  return {
    requested: true,
    authorized: isAuthorizedAdmin({ authorizationHeader, adminToken }),
  }
}

/**
 * Cache-control for a refresh response.
 *
 * A refresh response must never be cacheable. If a content delivery network stored
 * one, it would keep handing the freshly built body — or worse, pin the refresh URL
 * as a cache entry — to everyone else, which is exactly the staleness the refresh
 * was meant to clear.
 */
export const REFRESH_CACHE_CONTROL = 'no-store'
