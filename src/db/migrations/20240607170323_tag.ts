import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.tag)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.tag)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.tag, (t) => {
        t.text('providerId')
          .index()
          .notNullable()
          .references('providerId')
          .inTable(`${userConfig.database.schema}.${tableNames.provider}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        // for evm this is relevant for others less so
        t.text('key').notNullable().index()
        t.text('name').notNullable().index()
        t.text('description').notNullable().index().defaultTo('')
        t.primary(['providerId', 'key'])
        t.timestamps(true, true)
      })
    await knex.raw(utils.autoUpdateTimestamp([userConfig.database.schema, tableNames.tag]))
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.tag)
}
