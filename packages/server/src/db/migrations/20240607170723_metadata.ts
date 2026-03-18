import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.metadata, 'metadataId', [
  'providerId',
  'networkId',
  'listId',
  'providedId',
])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.metadata)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.metadata)
    await knex.schema.withSchema(userConfig.database.schema).createTable(tableNames.metadata, (t) => {
      t.text('providerId')
        .index()
        .notNullable()
        .references('providerId')
        .inTable(`${userConfig.database.schema}.${tableNames.provider}`)
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
      t.text('networkId')
        .index()
        .nullable()
        .references('networkId')
        .inTable(`${userConfig.database.schema}.${tableNames.network}`)
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
      t.text('listId')
        .index()
        .nullable()
        .references('listId')
        .inTable(`${userConfig.database.schema}.${tableNames.list}`)
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
      // id provided by the network
      t.specificType('providedId', 'citext').index().nullable()
      t.text('metadataId').notNullable().index().primary()
      t.jsonb('value').notNullable()
      t.timestamps(true, true)
    })
    await compositeId.up(knex)
    await utils.autoUpdateTimestamp.up(knex, tableNames.metadata)
  }
}

export async function down(knex: Knex): Promise<void> {
  await compositeId.down(knex)
  await utils.autoUpdateTimestamp.down(knex, tableNames.metadata)
  await knex.schema.withSchema(userConfig.database.schema).dropTableIfExists(tableNames.metadata)
}
