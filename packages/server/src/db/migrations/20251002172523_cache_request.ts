import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

// const tokenCompositeId = utils.compositeId(tableNames.token, 'tokenId', ['networkId', 'providedId'])

export async function up(knex: Knex): Promise<void> {
  const exists = await utils.schema(knex).hasTable(tableNames.cacheRequest)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.cacheRequest)
    await utils.schema(knex).createTable(tableNames.cacheRequest, (t) => {
      t.text('key').notNullable().index().primary()
      t.text('value').notNullable()
      t.timestamp('expiresAt', {
        useTz: true,
        precision: 3,
      }).defaultTo(knex.fn.now())
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await utils.schema(knex).dropTableIfExists(tableNames.cacheRequest)
}
