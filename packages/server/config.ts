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
 * `work_mem` granted to the ranked token query for the length of its own
 * transaction, set with `SET LOCAL`.
 *
 * That query sorts twice — once to reduce every list entry down to one row per
 * token, once to order the survivors by provider ranking — and Postgres moves a
 * sort to disk the moment it outgrows `work_mem`. The server default is 4MB,
 * which even a partially collected Ethereum overruns threefold, so both sorts
 * were running as external merges against temporary files.
 *
 * Raising the server-wide setting instead would be unsafe. `work_mem` is granted
 * per sort node per connection, so the ceiling is this figure multiplied by the
 * number of sorts times the number of connections running them — with two sorts
 * apiece, ten concurrent builds reserve twenty times what is written here. `SET
 * LOCAL` confines the grant to the one transaction that needs it, and the
 * single-flight cache build already bounds how many of those exist at once.
 *
 * Size it against the largest chain: a sort needs roughly 400 bytes per input
 * row, and spilling is only avoided when the whole sort fits. Raise it via
 * RANKED_QUERY_WORK_MEM once you know both the row count and the memory the
 * database instance can actually spare.
 *
 * The value is interpolated into the SET statement, which accepts no bind
 * parameters, so it must be a bare Postgres memory literal. Anything else throws
 * here rather than reaching the server.
 */
const rankedQueryWorkMem = process.env.RANKED_QUERY_WORK_MEM || '256MB'
if (!/^\d+(kB|MB|GB)$/.test(rankedQueryWorkMem)) {
  throw new Error(
    `RANKED_QUERY_WORK_MEM must be a Postgres memory literal such as "256MB", received "${rankedQueryWorkMem}"`,
  )
}

Error.stackTraceLimit = Infinity

export default {
  database,
  rootURI,
  cacheSeconds,
  adminToken,
  imageMaxAgeMs,
  rankedQueryWorkMem,
}
