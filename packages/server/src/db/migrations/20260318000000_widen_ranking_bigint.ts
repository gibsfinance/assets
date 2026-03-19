import type { Knex } from 'knex'

import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await utils.schema(knex).hasTable(tableNames.listOrderItem)
  if (exists) {
    log('widening column table=%o column=%o from smallint to bigint', tableNames.listOrderItem, 'ranking')
    await utils.schema(knex).alterTable(tableNames.listOrderItem, (t) => {
      t.bigint('ranking').index().notNullable().alter()
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await utils.schema(knex).hasTable(tableNames.listOrderItem)
  if (exists) {
    log('reverting column table=%o column=%o from bigint to smallint', tableNames.listOrderItem, 'ranking')
    await utils.schema(knex).alterTable(tableNames.listOrderItem, (t) => {
      t.smallint('ranking').index().notNullable().alter()
    })
  }
}
