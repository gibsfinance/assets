import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.link)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.link)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.link, (t) => {
        // how "we" as a data collection, categorize the data
        t.text('uri').index().notNullable().primary()
        t.text('imageHash').index().notNullable()
          .references('imageHash')
          .inTable(`${userConfig.database.schema}.${tableNames.image}`)
        t.timestamps(true, true)
      })
    await utils.autoUpdateTimestamp.up(knex, tableNames.link)
  }
}

export async function down(knex: Knex): Promise<void> {
  await utils.autoUpdateTimestamp.down(knex, tableNames.link)
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.link)
}
