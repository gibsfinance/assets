import type { Knex } from 'knex'
import userConfig from '../../../config'
import { log } from '../../logger'
import { tableNames } from '../tables'

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.withSchema(userConfig.database.schema).hasTable(tableNames.imageVariant)
  if (!exists) {
    log('creating table %o', tableNames.imageVariant)
    await knex.schema.withSchema(userConfig.database.schema).createTable(tableNames.imageVariant, (t) => {
      t.text('imageHash')
        .notNullable()
        .references('imageHash')
        .inTable(`${userConfig.database.schema}.${tableNames.image}`)
      t.integer('width').notNullable()
      t.integer('height').notNullable()
      t.text('format').notNullable()
      t.binary('content').notNullable()
      t.integer('accessCount').notNullable().defaultTo(1)
      t.timestamp('createdAt', { useTz: true, precision: 3 }).defaultTo(knex.fn.now())
      t.timestamp('lastAccessedAt', { useTz: true, precision: 3 }).defaultTo(knex.fn.now())
      t.primary(['imageHash', 'width', 'height', 'format'])
    })
    await knex.schema.withSchema(userConfig.database.schema).table(tableNames.imageVariant, (t) => {
      t.index(['accessCount', 'lastAccessedAt'], 'idx_image_variant_prune')
    })
    // NOTE: Do NOT revoke UPDATE — access_count bumping requires it
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema(userConfig.database.schema).dropTableIfExists(tableNames.imageVariant)
}
