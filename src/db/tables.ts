import type { Knex } from 'knex'

export const tableNames = {
  network: 'network',
  provider: 'provider',
  image: 'image',
  list: 'list',
  tag: 'tag',
  listTag: 'list_tag',
  token: 'token',
  metadata: 'metadata',
  listToken: 'list_token',
  link: 'link',
  listOrder: 'list_order',
  listOrderItem: 'list_order_item',
  bridge: 'bridge',
  bridgeLink: 'bridge_link',
} as const

const tn = Object.values(tableNames)

export type TableNames = (typeof tn)[number]

export type Tx = Knex | Knex.Transaction
