import type { Knex } from 'knex'

import configuration from './config'
import { makeConfig } from './src/db/config'

const config = makeConfig({
  connection: configuration.database.url,
})

const conf = {
  seeds: {
    directory: './src/db/seeds',
  },
  migrations: {
    directory: './src/db/migrations',
  },
  client: config.client,
  connection: config.connection,
  asyncStackTraces: config.asyncStackTraces,
  acquireConnectionTimeout: config.acquireConnectionTimeout,
  postProcessResponse: config.postProcessResponse,
  wrapIdentifier: config.wrapIdentifier,
} as Knex.Config

const development = conf
const production = conf

export default {
  development,
  production,
}
