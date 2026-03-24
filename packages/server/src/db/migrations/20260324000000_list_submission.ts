import type { Knex } from 'knex'

/**
 * List submission registry — allows users to submit their token list
 * URLs for inclusion in the Gib.Show collection pipeline.
 *
 * Approved submissions are fetched on every collection run, same as
 * hardcoded collector sources. Auto-mode promotes link → save based
 * on popularity.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('list_submission', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid())
    t.text('url').notNullable().index()
    t.text('name').notNullable()
    t.text('description').defaultTo('')
    t.text('submitted_by').notNullable().index()
    t.text('status').notNullable().defaultTo('pending').index()
    // status: 'pending' | 'approved' | 'rejected' | 'stale'
    t.text('provider_key').notNullable().index()
    t.text('list_key').notNullable()
    t.text('image_mode').notNullable().defaultTo('auto')
    // image_mode: 'link' | 'save' | 'auto'
    t.integer('fail_count').notNullable().defaultTo(0)
    t.integer('subscriber_count').notNullable().defaultTo(0)
    t.text('last_content_hash')
    t.timestamp('last_fetched_at')
    t.timestamp('last_accessed_at')
    t.timestamps(true, true)

    t.unique(['url'])
    t.unique(['provider_key', 'list_key'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('list_submission')
}
