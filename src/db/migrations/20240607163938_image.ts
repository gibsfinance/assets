import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.image, 'imageHash', ['content'])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.image)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.image)
    // await knex.raw(utils.preventUpdateConstraint())
    await knex.schema.withSchema(userConfig.database.schema).createTable(tableNames.image, (t) => {
      // hash of the contents property
      t.text('imageHash').index().notNullable().primary()
      // for evm this is relevant for others less so
      t.binary('content').notNullable()
      t.text('ext').index().notNullable()
      t.timestamp('createdAt', {
        useTz: true,
        precision: 3,
      }).defaultTo(knex.fn.now())
    })
    await compositeId.up(knex)
    await knex.raw(`REVOKE UPDATE ON ${tableNames.image} FROM ${userConfig.database.user}`)
  }
}

export async function down(knex: Knex): Promise<void> {
  await compositeId.down(knex)
  await knex.schema.withSchema(userConfig.database.schema).dropTableIfExists(tableNames.image)
}
