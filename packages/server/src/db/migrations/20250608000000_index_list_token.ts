import type { Knex } from 'knex'

import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const listTokenOrderId = 'list_token_order_id'
const bridgeLinkOrderId = 'bridge_link_order_id'

export async function up(knex: Knex): Promise<void> {
  const listTokenExists = await utils.schema(knex).hasTable(tableNames.listToken)
  if (listTokenExists) {
    log('adding column table=%o column=%o', tableNames.listToken, listTokenOrderId)
    await utils.schema(knex).alterTable(tableNames.listToken, (t) => {
      t.integer(listTokenOrderId).notNullable()
    })
  }
  const bridgeLinkExists = await utils.schema(knex).hasTable(tableNames.bridge)
  if (bridgeLinkExists) {
    log('adding column table=%o column=%o', tableNames.bridge, bridgeLinkOrderId)
    await utils.schema(knex).alterTable(tableNames.bridge, (t) => {
      t.integer(bridgeLinkOrderId).notNullable().defaultTo(0)
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  log('removing column table=%o column=%o', tableNames.listToken, listTokenOrderId)
  const listTokenExists = await utils.schema(knex).hasTable(tableNames.listToken)
  if (listTokenExists) {
    await utils.schema(knex).alterTable(tableNames.listToken, (t) => {
      t.dropColumn(listTokenOrderId)
    })
  }
  log('removing column table=%o column=%o', tableNames.bridge, bridgeLinkOrderId)
  const bridgeLinkExists = await utils.schema(knex).hasTable(tableNames.bridge)
  if (bridgeLinkExists) {
    await utils.schema(knex).alterTable(tableNames.bridge, (t) => {
      t.dropColumn(bridgeLinkOrderId)
    })
  }
}
