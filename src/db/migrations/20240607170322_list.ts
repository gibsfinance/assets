import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.list, 'listId', [
  'providerId', 'networkId', 'major', 'minor', 'patch',
])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.list)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.list)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.list, (t) => {
        t.text('providerId')
          .index()
          .notNullable()
          .references('providerId')
          .inTable(`${userConfig.database.schema}.${tableNames.provider}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        // for evm this is relevant for others less so
        t.text('networkId').index().notNullable()
          .references('networkId')
          .inTable(`${userConfig.database.schema}.${tableNames.network}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        // controlled by the provider
        t.text('name').nullable()
        t.text('description').nullable()
        // semantic: 0.0.0
        t.smallint('patch').notNullable().defaultTo(0)
        t.smallint('minor').notNullable().defaultTo(0)
        t.smallint('major').notNullable().defaultTo(0)
        // generation at creation time
        t.text('listId').index().primary().notNullable()
        t.timestamps(true, true)
      })
    await compositeId.up(knex)
    await knex.raw(utils.autoUpdateTimestamp([userConfig.database.schema, tableNames.list]))
  }
}

export async function down(knex: Knex): Promise<void> {
  await compositeId.down(knex)
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.list)
}
