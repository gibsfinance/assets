const database = {
  url: process.env.DATABASE_URL || 'postgres://gibassets:password@localhost:5876/gibassets',
  name: process.env.PGDATABASE || 'gibassets',
  user: process.env.POSTGRES_USER || 'gibassets',
  schema: 'public',
  ssl: false,
}
const rootURI = process.env.ROOT_URI || 'http://localhost:3456'

/**
 * Bearer token guarding admin endpoints (submission moderation and the
 * approved-submissions feed). Unset by default — admin endpoints respond
 * 401 until ADMIN_TOKEN is configured.
 */
const adminToken = process.env.ADMIN_TOKEN
let cacheSeconds = process.env.CACHE_SECONDS
if (!+(cacheSeconds as string)) {
  cacheSeconds = `${60 * 60}`
}

/**
 * How long a previously-fetched token/network logo is treated as fresh before it
 * is re-downloaded, in milliseconds. Controlled by the IMAGE_MAX_AGE_HOURS
 * environment variable (whole or fractional hours).
 *
 * The collect worker runs every 6 hours, so the previous hardcoded 6-hour window
 * sat exactly on the cron boundary — nearly every logo was re-fetched on every
 * run, which dominated collection time. Defaulting to 7 days means each run
 * reuses existing logos and only downloads images for genuinely new tokens, while
 * a changed logo still refreshes within a week. Lower it (e.g.
 * IMAGE_MAX_AGE_HOURS=24) for fresher logos at the cost of slower runs, or raise
 * it for faster runs.
 */
const imageMaxAgeHours = +(process.env.IMAGE_MAX_AGE_HOURS as string) || 24 * 7
const imageMaxAgeMs = imageMaxAgeHours * 60 * 60 * 1000

/**
 * Credentials for purging the content delivery network cache after a deploy.
 *
 * Both must be set for a purge to happen; either one missing makes it a logged no-op, so
 * a local or self-hosted deployment with no Cloudflare in front behaves exactly as it
 * did before. The token needs only the Zone / Cache Purge permission on the zone named
 * by CLOUDFLARE_ZONE_ID.
 *
 * Without these, a deploy that changes what a response contains is invisible to users
 * for as long as the edge holds the old body — measured at 15.7 hours against
 * production, and up to roughly two days once stale-while-revalidate is counted.
 */
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN
const cloudflareZoneId = process.env.CLOUDFLARE_ZONE_ID

Error.stackTraceLimit = Infinity

export default {
  database,
  rootURI,
  cacheSeconds,
  adminToken,
  imageMaxAgeMs,
  cloudflareApiToken,
  cloudflareZoneId,
}
