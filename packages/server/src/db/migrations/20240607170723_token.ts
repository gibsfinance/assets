import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const tokenCompositeId = utils.compositeId(tableNames.token, 'tokenId', ['networkId', 'providedId'])

export async function up(knex: Knex): Promise<void> {
  const exists = await utils.schema(knex).hasTable(tableNames.token)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.token)
    await utils.schema(knex).createTable(tableNames.token, (t) => {
      t.text('networkId')
        .index()
        .notNullable()
        .references('networkId')
        .inTable(`${userConfig.database.schema}.${tableNames.network}`)
        .onDelete('CASCADE')
        .onUpdate('CASCADE')
      // id provided by the network
      t.specificType('providedId', 'citext').index().notNullable()
      // base metadata for tokens
      t.text('name').index().notNullable()
      t.text('symbol').index().notNullable()
      t.smallint('decimals').index().notNullable().defaultTo(0)
      // network,provider,token,etc as provided by the collection system
      t.text('type').index().notNullable().defaultTo('unknown')
      t.timestamp('createdAt', {
        useTz: true,
        precision: 3,
      }).defaultTo(knex.fn.now())
      t.text('tokenId').notNullable().index().primary()
    })

    await tokenCompositeId.up(knex)
    await knex.raw(`REVOKE UPDATE ON ${tableNames.token} FROM ${userConfig.database.schema}`)
  }
}

export async function down(knex: Knex): Promise<void> {
  await tokenCompositeId.down(knex)
  await utils.schema(knex).dropTableIfExists(tableNames.token)
}
