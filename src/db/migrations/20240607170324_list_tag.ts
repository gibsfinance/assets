import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.listTag)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.listTag)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.listTag, (t) => {
        t.text('providerId')
          .index()
          .notNullable()
          .references('providerId')
          .inTable(`${userConfig.database.schema}.${tableNames.provider}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        t.text('listId')
          .index()
          .notNullable()
          .references('listId')
          .inTable(`${userConfig.database.schema}.${tableNames.list}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        // for evm this is relevant for others less so
        t.timestamps(true, true)
      })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.listTag)
}
