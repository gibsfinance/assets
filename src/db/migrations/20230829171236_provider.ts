import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const compositeId = utils.compositeId(tableNames.provider, 'providerId', ['key'])

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema)
    .hasTable(tableNames.provider)
  if (!exists) {
    log('creating table %o', tableNames.provider)
    await knex.schema.withSchema(userConfig.database.schema)
      .createTable(tableNames.provider, (t) => {
        // human readable, but not ui ready key
        t.text('providerId').index().primary().notNullable()
        // a shorthand, usually not something you would put into a ui. something kebabcase'd
        t.text('key').notNullable().index().unique()
        t.text('name')
        t.text('description')
        t.timestamps(true, true)
      })
    await compositeId.up(knex)
    await knex.raw(utils.autoUpdateTimestamp([userConfig.database.schema, tableNames.provider]))
  }
}

export async function down(knex: Knex): Promise<void> {
  await utils.dropGenerateCompositeIdAndTrigger(knex, tableNames.provider, 'providerId', ['key'])
  await compositeId.down(knex)
  await knex.schema.withSchema(userConfig.database.schema)
    .dropTableIfExists(tableNames.provider)
}
