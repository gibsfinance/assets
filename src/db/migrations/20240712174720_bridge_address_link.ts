import type { Knex } from 'knex'

import userConfig from '../../../config'
import { log } from '../../logger'
import * as utils from '../utils'
import { tableNames } from '../tables'

const bridgeCompositeId = utils.compositeId(tableNames.bridge, 'bridgeId', [
  'type',
  'provider',
  'homeNetworkId',
  'homeAddress',
  'foreignNetworkId',
  'foreignAddress',
])

const bridgeLinkCompositeId = utils.compositeId(tableNames.bridgeLink, 'bridgeLinkId', [
  'foreignTokenId',
  'homeTokenId',
  'bridgeId',
])

export async function up(knex: Knex): Promise<void> {
  const bridgeExists = await utils.schema(knex).hasTable(tableNames.bridge)
  if (!bridgeExists) {
    log('creating table %o', tableNames.bridge)
    await utils.schema(knex).createTable(tableNames.bridge, (t) => {
      // type of bridge (omnibridge, other)
      t.text('type').index().notNullable()
      t.text('provider').index().notNullable()
      utils.foreignColumn(t.text('homeNetworkId').index().notNullable(), 'networkId', tableNames.network)
      t.specificType('homeAddress', 'citext').index().notNullable()
      utils.foreignColumn(t.text('foreignNetworkId').index().notNullable(), 'networkId', tableNames.network)
      t.specificType('foreignAddress', 'citext').index().notNullable()
      t.text('bridgeId').primary().notNullable().index()
    })
    await bridgeCompositeId.up(knex)
  }
  const bridgeLinkExists = await utils.schema(knex).hasTable(tableNames.bridgeLink)
  if (!bridgeLinkExists) {
    // networks are a general categorization mechanism that are not bound by crypto networks
    // anywhere that a boundary exists - that is a network
    // one can even have networks inside of a single token hash (erc721/erc1155)
    log('creating table %o', tableNames.bridgeLink)
    await utils.schema(knex).createTable(tableNames.bridgeLink, (t) => {
      t.text('bridgeLinkId').primary().index().notNullable()
      utils.foreignColumn(t.text('foreignTokenId').index().notNullable(), 'tokenId', tableNames.token)
      utils.foreignColumn(t.text('homeTokenId').index().notNullable(), 'tokenId', tableNames.token)
      utils.foreignColumn(t.text('bridgeId').index().notNullable(), 'bridgeId', tableNames.bridge)
    })
    await bridgeLinkCompositeId.up(knex)

    await knex.raw(`REVOKE UPDATE ON ${tableNames.bridgeLink} FROM ${userConfig.database.schema}`)
  }
}

export async function down(knex: Knex): Promise<void> {
  // bridge links
  await bridgeLinkCompositeId.down(knex)
  await utils.schema(knex).dropTableIfExists(tableNames.bridgeLink)
  // bridge
  await bridgeCompositeId.down(knex)
  await utils.schema(knex).dropTableIfExists(tableNames.bridge)
}
