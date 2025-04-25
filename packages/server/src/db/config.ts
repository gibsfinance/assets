import type { Knex } from 'knex'
import _ from 'lodash'

import configuration from '../../config'

import { ignoreValues, objectToCamelCase } from './utils'

export const makeConfig = (overrides: Partial<Knex.Config>): Knex.Config => ({
  client: 'pg',
  asyncStackTraces: true,
  // debug: true,
  pool: {
    min: 1,
    max: 20,
  },
  seeds: {
    extension: 'ts',
    directory: './src/db/seeds',
  },
  migrations: {
    extension: 'ts',
    directory: './src/db/migrations',
  },
  postProcessResponse: (result: any) => {
    if (_.isArray(result)) {
      return result.map(objectToCamelCase)
    }
    return objectToCamelCase(result)
  },
  wrapIdentifier: (value: string, origImpl: (value: string) => string) =>
    ignoreValues[value] ? value : origImpl(_.snakeCase(value)),
  ...overrides,
})

export const config = makeConfig({
  connection: {
    connectionString: configuration.database.url,
    ssl: configuration.database.ssl
      ? {
          rejectUnauthorized: false,
        }
      : false,
    // requestTimeout: 60_000,
  },
})
