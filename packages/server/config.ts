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

Error.stackTraceLimit = Infinity

export default {
  database,
  rootURI,
  cacheSeconds,
  adminToken,
}
