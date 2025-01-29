const database = {
  url: process.env.DATABASE_URL || 'postgres://gibassets:password@localhost:5876/gibassets',
  name: process.env.PGDATABASE || 'gibassets',
  user: process.env.POSTGRES_USER || 'gibassets',
  schema: 'public',
  ssl: false,
}
const rootURI = process.env.ROOT_URI || 'http://localhost:3000'
let cacheSeconds = process.env.CACHE_SECONDS
if (!+(cacheSeconds as string)) {
  cacheSeconds = `${60 * 60}`
}

Error.stackTraceLimit = Infinity

export default {
  database,
  rootURI,
  cacheSeconds,
}
