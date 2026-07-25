/**
 * @module cdn-purge
 * Purges the content delivery network cache after a deploy.
 *
 * The server has never had a way to tell Cloudflare that a body it is holding is no
 * longer correct, and nothing else did it either. The result was that a deploy changing
 * what a response contains stayed invisible: measured against production, the edge kept
 * serving a list body 15.7 hours old while the origin had already rebuilt the new one.
 * `stale-while-revalidate` extends that to roughly two days in the worst case.
 *
 * Deleting the origin's own cached rows on boot — which is what used to happen — cannot
 * fix this. It clears the layer users do not reach and leaves the one they do.
 *
 * Purging is best-effort by design. A deploy must not fail because Cloudflare is
 * unreachable or a token expired; the consequence of a missed purge is stale content
 * that ages out on its own, which is exactly the behaviour that existed before.
 */
import config from '../../config'
import { log } from '../logger'

const PURGE_TIMEOUT_MS = 15_000

/** Cloudflare's purge endpoint reports failures in the body, not the status code. */
type PurgeResponse = { success?: boolean; errors?: { code?: number; message?: string }[] }

/**
 * Purge every cached response for the configured zone.
 *
 * Purge-by-tag would be narrower, but `Cache-Tag` is a Cloudflare Enterprise feature and
 * purge-by-url needs the full list of URLs in cache, which for per-chain and per-list
 * endpoints is unbounded. Purging the zone is the honest option at this size: the
 * origin's own cache survives a deploy now, so refilling the edge costs cache reads
 * rather than the ranked queries it used to.
 *
 * Returns whether a purge was actually performed, so a caller can log the difference
 * between "purged" and "not configured" rather than implying success either way.
 */
export const purgeCdnCache = async (): Promise<boolean> => {
  const { cloudflareApiToken, cloudflareZoneId } = config
  if (!cloudflareApiToken || !cloudflareZoneId) {
    log('content delivery network purge skipped: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID unset')
    return false
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PURGE_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/purge_cache`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cloudflareApiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ purge_everything: true }),
      signal: controller.signal,
    })
    // A 403 here means the token lacks the Cache Purge permission, which is worth saying
    // plainly — it is the one failure that looks like success from the outside, because
    // the deploy carries on and the content is simply never refreshed.
    const body = (await res.json().catch(() => ({}))) as PurgeResponse
    if (!res.ok || body.success === false) {
      const reason = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `status ${res.status}`
      log('content delivery network purge failed (%s); edge keeps serving until it expires', reason)
      return false
    }
    log('content delivery network cache purged')
    return true
  } catch (err: unknown) {
    log('content delivery network purge failed: %o', err)
    return false
  } finally {
    clearTimeout(timer)
  }
}
