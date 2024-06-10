import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.listOrder, 'listOrderId', [
  'providerId', 'key',
])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.listOrder)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.listOrder)
    // await knex.schema.withSchema(userConfig.database.schema)
    //   .alterTable(tableNames.list, (t) => {
    //     t.unique(['providerId', 'key'])
    //   })
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.listOrder, (t) => {
        // this is the owner of the order
        t.text('providerId').notNullable().index()
          .references('providerId')
          .inTable(`${userConfig.database.schema}.${tableNames.provider}`)
        t.text('key').notNullable().index()
        t.text('type').notNullable().index()
        t.text('name').nullable()
        t.text('description').nullable()
        t.text('listOrderId').notNullable().index().primary()
        t.timestamps(true, true)
      })
    await compositeId.up(knex)
    await utils.autoUpdateTimestamp.up(knex, tableNames.listOrder)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.listOrderItem, (t) => {
        t.text('listOrderId').notNullable().index()
          .references('listOrderId')
          .inTable(`${userConfig.database.schema}.${tableNames.listOrder}`)
        // cannot directly reference as foreign because key is not unique
        // in list table provider+key+major+minor+patch is unique
        t.text('listKey').notNullable().index()
        // this is the owner of the list
        t.text('providerId').notNullable().index()
          .references('providerId')
          .inTable(`${userConfig.database.schema}.${tableNames.provider}`)
        // optionally, this list id can be used to supercede others of the same key
        t.text('listId').nullable().index()
          .references('listId')
          .inTable(`${userConfig.database.schema}.${tableNames.list}`)
        t.smallint('ranking').index().notNullable()
        t.primary(['listOrderId', 'ranking'])
        t.timestamps(true, true)
      })
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.listOrderItem)
  await compositeId.down(knex)
  await utils.autoUpdateTimestamp.down(knex, tableNames.listOrder)
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.listOrder)
}
