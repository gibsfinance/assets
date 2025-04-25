import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.network, 'networkId', ['type', 'chainId'])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.network)
  if (!exists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.network)
    await knex.schema.withSchema(userConfig.database.schema).createTable(tableNames.network, (t) => {
      // for evm this is relevant for others less so
      t.text('networkId').index().primary().notNullable()
      // evm,utxo,etc
      t.text('type').index().notNullable()
      t.decimal('chainId', 78, 0).index().notNullable()
      // the name of the network according to the provider
      t.timestamps(true, true)
    })
    await compositeId.up(knex)
    await knex.raw(`REVOKE UPDATE ON ${tableNames.network} FROM ${userConfig.database.user}`)
  }
}

export async function down(knex: Knex): Promise<void> {
  await compositeId.down(knex)
  await knex.schema.withSchema(userConfig.database.schema).dropTableIfExists(tableNames.network)
}
