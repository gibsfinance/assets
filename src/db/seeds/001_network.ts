import { Knex } from 'knex'
import * as db from '../'
import { tableNames } from '../tables'
import { zeroAddress } from 'viem'

export async function seed(knex: Knex): Promise<void> {
  // const providerGibs =
  await db.insertProvider(
    {
      name: 'Gibs',
      key: 'gibs',
      description: 'a memetic company',
    },
    knex,
  )
  // network
  // await knex.transaction(async (t) => {
  const t = knex
  const [, network1] = await t(tableNames.network)
    .insert([
      {
        type: 'evm',
        chainId: '0',
      },
      {
        type: 'evm',
        chainId: '1',
      },
    ])
    .onConflict(['networkId'])
    .merge(['chainId', 'type'])
    .returning('*')
  const [providerGibs] = await t(tableNames.provider)
    .insert([
      {
        name: 'Gibs',
        key: 'gibs',
        description: 'a memetic company',
      },
    ])
    .onConflict(['providerId'])
    .merge(['name', 'key', 'description'])
    .returning('*')
  // const [firstList] =
  await t(tableNames.list)
    .insert([
      {
        patch: 1,
        minor: 0,
        major: 0,
        providerId: providerGibs.providerId,
        networkId: network1.networkId,
      },
    ])
    .onConflict(['listId'])
    .merge(['patch', 'minor', 'major', 'providerId', 'networkId'])
    .returning('*')
  // const [updated] = await t(tableNames.list)
  //   .update({
  //     patch: 1,
  //   })
  //   .where('listId', firstList.listId)
  //   .returning('*')
  // console.log('list id %o -> %o', firstList.listId, updated.listId)
  const [token] = await t(tableNames.token)
    .insert([
      {
        networkId: network1.networkId,
        providedId: zeroAddress,
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        type: 'native',
      },
    ])
    .onConflict(['tokenId'])
    .merge(['networkId', 'providedId', 'name', 'symbol', 'decimals', 'type'])
    .returning('*')
  const [updatedNetwork1] = await t(tableNames.network)
    .update({
      type: 'evml2',
    })
    .where('networkId', network1.networkId)
    .returning(['networkId', 'type', 'chainId'])
  console.log('network id %o -> %o', network1.networkId, updatedNetwork1.networkId)
  const updatedToken = await t(tableNames.token)
    .select('*')
    .where({
      providedId: zeroAddress,
      networkId: updatedNetwork1.networkId,
    })
    .first()
  console.log('tknnwrk id %o -> %o', token.networkId, updatedToken?.networkId)
  await t(tableNames.network)
    .update({
      type: 'evm',
    })
    .where('networkId', updatedNetwork1.networkId)
  // })
}
