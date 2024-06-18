import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.listToken, 'listTokenId', [
  'networkId', 'providedId', 'listId',
])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.listToken)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.listToken)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.listToken, (t) => {
        // how "we" as a data collection, categorize the data
        t.text('networkId').index().notNullable()
        // .references('networkId')
        // .inTable(`${userConfig.database.schema}.${tableNames.network}`)
        t.specificType('providedId', 'citext').index().notNullable()
        // .references('providedId')
        // .inTable(`${userConfig.database.schema}.${tableNames.token}`)
        t.foreign(['networkId', 'providedId'])
          .references(['networkId', 'providedId'])
          .inTable(`${userConfig.database.schema}.${tableNames.token}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        t.text('listId').index().notNullable()
          .references('listId')
          .inTable(`${userConfig.database.schema}.${tableNames.list}`)
          .onDelete('CASCADE')
          .onUpdate('CASCADE')
        // how "they" as a data provider, categorizes the collection
        // this will be 0x00 or some other null value for
        // images that are not categorized under a hash/key that comes from that network
        t.text('imageHash').index().nullable()
          .references('imageHash')
          .inTable(`${userConfig.database.schema}.${tableNames.image}`)
        t.text('listTokenId').index().notNullable().primary()
        t.timestamps(true, true)
      })
    await compositeId.up(knex)
    await utils.autoUpdateTimestamp.up(knex, tableNames.listToken)
  }
}

export async function down(knex: Knex): Promise<void> {
  await compositeId.down(knex)
  await utils.autoUpdateTimestamp.down(knex, tableNames.listToken)
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.listToken)
}
