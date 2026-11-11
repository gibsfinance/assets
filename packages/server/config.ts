import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLimit } from './src/runtime/read-limit'

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
 * How much work the collector does at once. Every value is a whole number of at least one;
 * anything else falls back to the default (see `readLimit`). The defaults are the values
 * the code used before they were settable, so an unset deployment behaves as it always did.
 * A small host lowers them: each unit is a buffered download plus an image re-encode.
 *
 *   COLLECT_PROVIDER_CONCURRENCY  providers collected in parallel          (default 4)
 *   IMAGE_FETCH_CONCURRENCY       logos downloaded at once while a list's
 *                                 tokens are stored                         (default 8)
 *   IMAGE_PREWARM_CONCURRENCY     logos downloaded at once while a list is
 *                                 prewarmed                                 (default 8)
 *
 * `--concurrency` on the collect command still overrides the provider setting.
 */
const concurrency = {
  providers: readLimit(process.env.COLLECT_PROVIDER_CONCURRENCY, 4),
  imageFetches: readLimit(process.env.IMAGE_FETCH_CONCURRENCY, 8),
  imagePrewarm: readLimit(process.env.IMAGE_PREWARM_CONCURRENCY, 8),
}

/**
 * Bounds for sharp, the image library, applied once at start-up by both processes
 * (see `applySharpLimits`). Its own defaults let the cache grow to 50 MB, keep 100
 * files open and run one thread per core, which a small host cannot afford.
 *
 *   SHARP_CACHE_MEMORY_MB  pixel cache size in megabytes   (default 16)
 *   SHARP_CACHE_ITEMS      most operations kept in cache   (default 64)
 *   SHARP_CONCURRENCY      threads libvips may use         (default 1)
 *
 * The file cache is always off: nothing here reads the same file twice.
 */
const sharp = {
  cacheMemoryMegabytes: readLimit(process.env.SHARP_CACHE_MEMORY_MB, 16),
  cacheItems: readLimit(process.env.SHARP_CACHE_ITEMS, 64),
  concurrency: readLimit(process.env.SHARP_CONCURRENCY, 1),
}

/**
 * Directory that holds the content-addressed image store (see `image-store/`).
 * Set IMAGE_STORE_DIR to move it, for example onto a volume that outlives the
 * container. The default sits in the repository root and is ignored by git.
 */
const imageStoreDirectory = process.env.IMAGE_STORE_DIR
  ? path.resolve(process.env.IMAGE_STORE_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'image-store')

Error.stackTraceLimit = Infinity

export default {
  database,
  rootURI,
  cacheSeconds,
  adminToken,
  imageMaxAgeMs,
  concurrency,
  sharp,
  imageStoreDirectory,
}
