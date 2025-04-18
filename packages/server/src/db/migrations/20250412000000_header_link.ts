import type { Knex } from 'knex'

import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const headerLinkExists = await utils.schema(knex).hasTable(tableNames.headerLink)
  if (!headerLinkExists) {
    log('creating table %o', tableNames.headerLink)
    await utils.schema(knex).createTable(tableNames.headerLink, (t) => {
      utils.foreignColumn(t.text('listTokenId').index().notNullable(), 'listTokenId', tableNames.listToken).primary()
      utils.foreignColumn(t.text('imageHash').index().notNullable(), 'imageHash', tableNames.image)
      t.timestamps(true, true)
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  await utils.schema(knex).dropTableIfExists(tableNames.headerLink)
}
