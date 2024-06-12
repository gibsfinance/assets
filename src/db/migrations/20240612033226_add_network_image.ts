import type { Knex } from 'knex'

import userConfig from '../../../config'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.network)
  if (exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    await knex.schema.withSchema(userConfig.database.schema)
      .alterTable(tableNames.network, (t) => {
        t.text('imageHash').index().nullable()
          .references('imageHash')
          .inTable(`${userConfig.database.schema}.${tableNames.image}`)
      })
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.network)
  if (exists) {
    await knex.schema.withSchema(userConfig.database.schema)
      .alterTable(tableNames.network, (t) => {
        t.dropColumn('imageHash')
      })
  }
}
