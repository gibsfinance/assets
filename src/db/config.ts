import type { Knex } from 'knex'
import _ from 'lodash'

import configuration from '../../config'

import {
  ignoreValues,
  objectToCamelCase,
} from './utils'

export const makeConfig = (overrides: Partial<Knex.Config>): Knex.Config => ({
  client: 'pg',
  asyncStackTraces: true,
  acquireConnectionTimeout: 1_000_000,
  pool: {
    min: 0,
    max: 40,
    // idleTimeoutMillis: 60_000,
    // reapIntervalMillis: 500,
    // acquireTimeoutMillis: 300_000,
    // createTimeoutMillis: 300_000,
    // destroyTimeoutMillis: 300_000,
    // createRetryIntervalMillis: 2_000,
  },
  // debug: true,
  seeds: {
    extension: 'ts',
    directory: './src/db/seeds',
  },
  migrations: {
    extension: 'ts',
    directory: './src/db/migrations',
  },
  postProcessResponse: (result: any, _queryContext: any) => {
    if (_.isArray(result)) {
      return result.map(objectToCamelCase)
    }
    return objectToCamelCase(result)
  },
  wrapIdentifier: (value: string, origImpl: (value: string) => string, _queryContext: any) => (
    ignoreValues[value] ? value : origImpl(_.snakeCase(value))
  ),
  ...overrides,
})

export const config = makeConfig({
  connection: {
    connectionString: configuration.database.url,
    ssl: configuration.database.ssl ? {
      rejectUnauthorized: false,
    } : false,
    // requestTimeout: 60_000,
  },
})
