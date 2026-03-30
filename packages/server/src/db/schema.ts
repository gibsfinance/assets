import {
  pgTable,
  integer,
  timestamp,
  index,
  unique,
  text,
  foreignKey,
  jsonb,
  smallint,
  numeric,
  boolean,
  bigint,
  uuid,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Custom types for PostgreSQL extensions
// ---------------------------------------------------------------------------

/** bytea columns — stored as Buffer in Node.js */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/** citext columns — case-insensitive text (requires citext extension) */
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext'
  },
})

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const provider = pgTable(
  'provider',
  {
    providerId: text('provider_id').primaryKey().notNull(),
    key: text().notNull(),
    name: text().default(''),
    description: text().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index().using('btree', table.key.asc().nullsLast().op('text_ops')),
    index('provider_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    unique('provider_key_unique').on(table.key),
  ],
)

export const image = pgTable(
  'image',
  {
    imageHash: text('image_hash').primaryKey().notNull(),
    content: bytea('content').notNull(),
    uri: text().notNull(),
    ext: text().notNull(),
    mode: text().notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'string' }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index().using('btree', table.ext.asc().nullsLast().op('text_ops')),
    index('image_imagehash_index').using('btree', table.imageHash.asc().nullsLast().op('text_ops')),
    index().using('btree', table.mode.asc().nullsLast().op('text_ops')),
    index().using('btree', table.uri.asc().nullsLast().op('text_ops')),
  ],
)

export const network = pgTable(
  'network',
  {
    networkId: text('network_id').primaryKey().notNull(),
    type: text().notNull(),
    chainId: numeric('chain_id', { precision: 78, scale: 0 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    imageHash: text('image_hash'),
  },
  (table) => [
    index('network_chainid_index').using('btree', table.chainId.asc().nullsLast().op('numeric_ops')),
    index('network_imagehash_index').using('btree', table.imageHash.asc().nullsLast().op('text_ops')),
    index('network_networkid_index').using('btree', table.networkId.asc().nullsLast().op('text_ops')),
    index().using('btree', table.type.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.imageHash],
      foreignColumns: [image.imageHash],
      name: 'network_imagehash_foreign',
    }),
  ],
)

export const token = pgTable(
  'token',
  {
    networkId: text('network_id').notNull(),
    providedId: citext('provided_id').notNull(),
    name: text().notNull(),
    symbol: text().notNull(),
    decimals: smallint()
      .default(sql`'0'`)
      .notNull(),
    type: text().default('unknown').notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'string' }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    tokenId: text('token_id').primaryKey().notNull(),
  },
  (table) => [
    index().using('btree', table.decimals.asc().nullsLast().op('int2_ops')),
    index().using('btree', table.name.asc().nullsLast().op('text_ops')),
    index('token_networkid_index').using('btree', table.networkId.asc().nullsLast().op('text_ops')),
    index('token_providedid_index').using('btree', table.providedId.asc().nullsLast().op('citext_ops')),
    index().using('btree', table.symbol.asc().nullsLast().op('text_ops')),
    index('token_tokenid_index').using('btree', table.tokenId.asc().nullsLast().op('text_ops')),
    index().using('btree', table.type.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.networkId],
      foreignColumns: [network.networkId],
      name: 'token_networkid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const list = pgTable(
  'list',
  {
    providerId: text('provider_id').notNull(),
    networkId: text('network_id'),
    key: text().default('default').notNull(),
    name: text(),
    description: text(),
    patch: smallint()
      .default(sql`'0'`)
      .notNull(),
    minor: smallint()
      .default(sql`'0'`)
      .notNull(),
    major: smallint()
      .default(sql`'0'`)
      .notNull(),
    imageHash: text('image_hash'),
    listId: text('list_id').primaryKey().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    default: boolean().default(false).notNull(),
  },
  (table) => [
    index('list_imagehash_index').using('btree', table.imageHash.asc().nullsLast().op('text_ops')),
    index().using('btree', table.key.asc().nullsLast().op('text_ops')),
    index('list_listid_index').using('btree', table.listId.asc().nullsLast().op('text_ops')),
    index('list_networkid_index').using('btree', table.networkId.asc().nullsLast().op('text_ops')),
    index('list_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'list_providerid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.networkId],
      foreignColumns: [network.networkId],
      name: 'list_networkid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.imageHash],
      foreignColumns: [image.imageHash],
      name: 'list_imagehash_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const listToken = pgTable(
  'list_token',
  {
    tokenId: text('token_id').notNull(),
    listId: text('list_id').notNull(),
    imageHash: text('image_hash'),
    listTokenId: text('list_token_id').primaryKey().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    listTokenOrderId: integer('list_token_order_id').notNull(),
  },
  (table) => [
    index('list_token_imagehash_index').using('btree', table.imageHash.asc().nullsLast().op('text_ops')),
    index('list_token_listid_index').using('btree', table.listId.asc().nullsLast().op('text_ops')),
    index('list_token_listtokenid_index').using('btree', table.listTokenId.asc().nullsLast().op('text_ops')),
    index('list_token_tokenid_index').using('btree', table.tokenId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.tokenId],
      foreignColumns: [token.tokenId],
      name: 'list_token_tokenid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.listId],
      foreignColumns: [list.listId],
      name: 'list_token_listid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.imageHash],
      foreignColumns: [image.imageHash],
      name: 'list_token_imagehash_foreign',
    }),
  ],
)

export const link = pgTable(
  'link',
  {
    uri: text().primaryKey().notNull(),
    imageHash: text('image_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('link_imagehash_index').using('btree', table.imageHash.asc().nullsLast().op('text_ops')),
    index().using('btree', table.uri.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.imageHash],
      foreignColumns: [image.imageHash],
      name: 'link_imagehash_foreign',
    }),
  ],
)

export const tag = pgTable(
  'tag',
  {
    providerId: text('provider_id').notNull(),
    key: text().notNull(),
    name: text().notNull(),
    description: text().default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index().using('btree', table.description.asc().nullsLast().op('text_ops')),
    index().using('btree', table.key.asc().nullsLast().op('text_ops')),
    index().using('btree', table.name.asc().nullsLast().op('text_ops')),
    index('tag_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'tag_providerid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    primaryKey({ columns: [table.providerId, table.key], name: 'tag_pkey' }),
  ],
)

export const listTag = pgTable(
  'list_tag',
  {
    providerId: text('provider_id').notNull(),
    listId: text('list_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('list_tag_listid_index').using('btree', table.listId.asc().nullsLast().op('text_ops')),
    index('list_tag_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'list_tag_providerid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.listId],
      foreignColumns: [list.listId],
      name: 'list_tag_listid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const metadata = pgTable(
  'metadata',
  {
    providerId: text('provider_id').notNull(),
    networkId: text('network_id'),
    listId: text('list_id'),
    providedId: citext('provided_id'),
    metadataId: text('metadata_id').primaryKey().notNull(),
    value: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('metadata_listid_index').using('btree', table.listId.asc().nullsLast().op('text_ops')),
    index('metadata_metadataid_index').using('btree', table.metadataId.asc().nullsLast().op('text_ops')),
    index('metadata_networkid_index').using('btree', table.networkId.asc().nullsLast().op('text_ops')),
    index('metadata_providedid_index').using('btree', table.providedId.asc().nullsLast().op('citext_ops')),
    index('metadata_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'metadata_providerid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.networkId],
      foreignColumns: [network.networkId],
      name: 'metadata_networkid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.listId],
      foreignColumns: [list.listId],
      name: 'metadata_listid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const listOrder = pgTable(
  'list_order',
  {
    providerId: text('provider_id').notNull(),
    key: text().notNull(),
    type: text().notNull(),
    name: text(),
    description: text(),
    listOrderId: text('list_order_id').primaryKey().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index().using('btree', table.key.asc().nullsLast().op('text_ops')),
    index('list_order_listorderid_index').using('btree', table.listOrderId.asc().nullsLast().op('text_ops')),
    index('list_order_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    index().using('btree', table.type.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'list_order_providerid_foreign',
    }),
  ],
)

export const listOrderItem = pgTable(
  'list_order_item',
  {
    listOrderId: text('list_order_id').notNull(),
    listKey: text('list_key').notNull(),
    providerId: text('provider_id').notNull(),
    listId: text('list_id'),
    ranking: bigint({ mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('list_order_item_listid_index').using('btree', table.listId.asc().nullsLast().op('text_ops')),
    index('list_order_item_listkey_index').using('btree', table.listKey.asc().nullsLast().op('text_ops')),
    index('list_order_item_listorderid_index').using('btree', table.listOrderId.asc().nullsLast().op('text_ops')),
    index('list_order_item_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    index().using('btree', table.ranking.asc().nullsLast().op('int8_ops')),
    foreignKey({
      columns: [table.listOrderId],
      foreignColumns: [listOrder.listOrderId],
      name: 'list_order_item_listorderid_foreign',
    }),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'list_order_item_providerid_foreign',
    }),
    foreignKey({
      columns: [table.listId],
      foreignColumns: [list.listId],
      name: 'list_order_item_listid_foreign',
    }),
    primaryKey({ columns: [table.listOrderId, table.ranking], name: 'list_order_item_pkey' }),
  ],
)

export const bridge = pgTable(
  'bridge',
  {
    type: text().notNull(),
    providerId: text('provider_id').notNull(),
    homeNetworkId: text('home_network_id').notNull(),
    homeAddress: citext('home_address').notNull(),
    foreignNetworkId: text('foreign_network_id').notNull(),
    foreignAddress: citext('foreign_address').notNull(),
    bridgeId: text('bridge_id').primaryKey().notNull(),
    currentForeignBlockNumber: bigint('current_foreign_block_number', { mode: 'number' })
      .default(sql`'0'`)
      .notNull(),
    currentHomeBlockNumber: bigint('current_home_block_number', { mode: 'number' })
      .default(sql`'0'`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    bridgeLinkOrderId: integer('bridge_link_order_id').default(0).notNull(),
  },
  (table) => [
    index('bridge_bridgeid_index').using('btree', table.bridgeId.asc().nullsLast().op('text_ops')),
    index('bridge_currentforeignblocknumber_index').using(
      'btree',
      table.currentForeignBlockNumber.asc().nullsLast().op('int8_ops'),
    ),
    index('bridge_currenthomeblocknumber_index').using(
      'btree',
      table.currentHomeBlockNumber.asc().nullsLast().op('int8_ops'),
    ),
    index('bridge_foreignaddress_index').using('btree', table.foreignAddress.asc().nullsLast().op('citext_ops')),
    index('bridge_foreignnetworkid_index').using('btree', table.foreignNetworkId.asc().nullsLast().op('text_ops')),
    index('bridge_homeaddress_index').using('btree', table.homeAddress.asc().nullsLast().op('citext_ops')),
    index('bridge_homenetworkid_index').using('btree', table.homeNetworkId.asc().nullsLast().op('text_ops')),
    index('bridge_providerid_index').using('btree', table.providerId.asc().nullsLast().op('text_ops')),
    index().using('btree', table.type.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.providerId],
      foreignColumns: [provider.providerId],
      name: 'bridge_providerid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.homeNetworkId],
      foreignColumns: [network.networkId],
      name: 'bridge_homenetworkid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.foreignNetworkId],
      foreignColumns: [network.networkId],
      name: 'bridge_foreignnetworkid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const bridgeLink = pgTable(
  'bridge_link',
  {
    bridgeLinkId: text('bridge_link_id').primaryKey().notNull(),
    nativeTokenId: text('native_token_id').notNull(),
    bridgedTokenId: text('bridged_token_id').notNull(),
    bridgeId: text('bridge_id').notNull(),
    transactionHash: text('transaction_hash').notNull(),
  },
  (table) => [
    index('bridge_link_bridgedtokenid_index').using('btree', table.bridgedTokenId.asc().nullsLast().op('text_ops')),
    index('bridge_link_bridgeid_index').using('btree', table.bridgeId.asc().nullsLast().op('text_ops')),
    index('bridge_link_bridgelinkid_index').using('btree', table.bridgeLinkId.asc().nullsLast().op('text_ops')),
    index('bridge_link_nativetokenid_index').using('btree', table.nativeTokenId.asc().nullsLast().op('text_ops')),
    index('bridge_link_transactionhash_index').using('btree', table.transactionHash.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.nativeTokenId],
      foreignColumns: [token.tokenId],
      name: 'bridge_link_nativetokenid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.bridgedTokenId],
      foreignColumns: [token.tokenId],
      name: 'bridge_link_bridgedtokenid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.bridgeId],
      foreignColumns: [bridge.bridgeId],
      name: 'bridge_link_bridgeid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const headerLink = pgTable(
  'header_link',
  {
    listTokenId: text('list_token_id').primaryKey().notNull(),
    imageHash: text('image_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('header_link_imagehash_index').using('btree', table.imageHash.asc().nullsLast().op('text_ops')),
    index('header_link_listtokenid_index').using('btree', table.listTokenId.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.listTokenId],
      foreignColumns: [listToken.listTokenId],
      name: 'header_link_listtokenid_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.imageHash],
      foreignColumns: [image.imageHash],
      name: 'header_link_imagehash_foreign',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
)

export const cacheRequest = pgTable(
  'cache_request',
  {
    key: text().primaryKey().notNull(),
    value: text().notNull(),
    expiresAt: timestamp('expires_at', { precision: 3, withTimezone: true, mode: 'string' }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [index().using('btree', table.key.asc().nullsLast().op('text_ops'))],
)

export const imageVariant = pgTable(
  'image_variant',
  {
    imageHash: text('image_hash').notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    format: text().notNull(),
    content: bytea('content').notNull(),
    accessCount: integer('access_count').default(1).notNull(),
    createdAt: timestamp('created_at', { precision: 3, withTimezone: true, mode: 'string' }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
    lastAccessedAt: timestamp('last_accessed_at', { precision: 3, withTimezone: true, mode: 'string' }).default(
      sql`CURRENT_TIMESTAMP`,
    ),
  },
  (table) => [
    index('idx_image_variant_prune').using(
      'btree',
      table.accessCount.asc().nullsLast().op('int4_ops'),
      table.lastAccessedAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    foreignKey({
      columns: [table.imageHash],
      foreignColumns: [image.imageHash],
      name: 'image_variant_imagehash_foreign',
    }),
    primaryKey({ columns: [table.imageHash, table.width, table.height, table.format], name: 'image_variant_pkey' }),
  ],
)

export const listSubmission = pgTable(
  'list_submission',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    url: text().notNull(),
    name: text().notNull(),
    description: text().default(''),
    submittedBy: text('submitted_by').notNull(),
    status: text().default('pending').notNull(),
    providerKey: text('provider_key').notNull(),
    listKey: text('list_key').notNull(),
    imageMode: text('image_mode').default('auto').notNull(),
    failCount: integer('fail_count').default(0).notNull(),
    subscriberCount: integer('subscriber_count').default(0).notNull(),
    lastContentHash: text('last_content_hash'),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true, mode: 'string' }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index().using('btree', table.providerKey.asc().nullsLast().op('text_ops')),
    index().using('btree', table.status.asc().nullsLast().op('text_ops')),
    index().using('btree', table.submittedBy.asc().nullsLast().op('text_ops')),
    index().using('btree', table.url.asc().nullsLast().op('text_ops')),
    unique('list_submission_url_unique').on(table.url),
    unique('list_submission_provider_key_list_key_unique').on(table.providerKey, table.listKey),
  ],
)
