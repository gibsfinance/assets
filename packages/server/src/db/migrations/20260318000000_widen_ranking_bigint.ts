import type { Knex } from 'knex'

import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'
import userConfig from '../../../config'

const table = `${userConfig.database.schema}.${tableNames.listOrderItem}`

export async function up(knex: Knex): Promise<void> {
  const exists = await utils.schema(knex).hasTable(tableNames.listOrderItem)
  if (!exists) return
  log('widening column table=%o column=%o from smallint to bigint', tableNames.listOrderItem, 'ranking')
  // ranking is part of PK (listOrderId, ranking) — must drop PK, alter, recreate
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS list_order_item_pkey`)
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ranking TYPE bigint`)
  await knex.raw(`ALTER TABLE ${table} ADD PRIMARY KEY ("list_order_id", "ranking")`)
}

export async function down(knex: Knex): Promise<void> {
  const exists = await utils.schema(knex).hasTable(tableNames.listOrderItem)
  if (!exists) return
  log('reverting column table=%o column=%o from bigint to smallint', tableNames.listOrderItem, 'ranking')
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS list_order_item_pkey`)
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ranking TYPE smallint`)
  await knex.raw(`ALTER TABLE ${table} ADD PRIMARY KEY ("list_order_id", "ranking")`)
}
