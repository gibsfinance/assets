import type { Knex } from 'knex'

import userConfig from '../../../config'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.list)
  if (exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    await knex.schema.withSchema(userConfig.database.schema).alterTable(tableNames.list, (t) => {
      t.boolean('default').notNullable().defaultTo(false)
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.list)
  if (exists) {
    await knex.schema.withSchema(userConfig.database.schema).alterTable(tableNames.list, (t) => {
      t.dropColumn('default')
    })
  }
}
