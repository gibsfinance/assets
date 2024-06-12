import { Knex } from 'knex'
import { tableNames } from '../tables'

// import { tableNames } from '../tables'

// import type { } from 'knex/types/tables'
// import { zeroAddress } from 'viem'

export async function seed(knex: Knex): Promise<void> {
  const [providerGibs] = await knex(tableNames.provider)
    .insert([{
      name: 'Gibs',
      key: 'gibs',
      description: 'a memetic company',
    }])
    .onConflict(['providerId'])
    .merge(['providerId'])
    .returning('*')
  // await knex.transaction(async (t) => {
  //   const [defaultNetwork, network1] = await t(tableNames.network)
  //     .insert([{
  //       type: 'evm',
  //       chainId: 0,
  //     }, {
  //       type: 'evm',
  //  network     chainId: 1,
  //     }])
  //     .returning('*')
  //   const [providerGibs] = await t(tableNames.provider)
  //     .insert([{
  //       name: 'Gibs',
  //       key: 'gibs',
  //       description: 'a memetic company',
  //     }])
  //     .returning('*')
  //   const [firstList] = await t(tableNames.list)
  //     .insert([{
  //       patch: 0,
  //       minor: 0,
  //       major: 0,
  //       providerId: providerGibs.providerId,
  //       networkId: network1.networkId,
  //     }])
  //     .returning('*')
  //   const [updated] = await t(tableNames.list)
  //     .update({
  //       patch: 1,
  //     }).where('listId', firstList.listId)
  //     .returning('*')
  //   console.log('list id %o -> %o', firstList.listId, updated.listId)
  //   const [token] = await t(tableNames.token)
  //     .insert([{
  //       networkId: network1.networkId,
  //       providedId: zeroAddress,
  //       name: 'Ether',
  //       symbol: 'ETH',
  //       decimals: 18,
  //       type: 'native',
  //     }])
  //     .returning('*')
  //   const [updatedNetwork1] = await t(tableNames.network)
  //     .update({
  //       type: 'evml2',
  //     }).where('networkId', network1.networkId)
  //     .returning([
  //       'networkId',
  //       'type',
  //       'chainId',
  //     ])
  //   console.log('network id %o -> %o', network1.networkId, updatedNetwork1.networkId)
  //   const updatedToken = await t(tableNames.token)
  //     .select('*')
  //     .where({
  //       providedId: zeroAddress,
  //       networkId: updatedNetwork1.networkId,
  //     })
  //     .first()
  //   console.log('tknnwrk id %o -> %o', token.networkId, updatedToken.networkId)
  //   await t(tableNames.network)
  //     .update({
  //       type: 'evm',
  //     }).where('networkId', updatedNetwork1.networkId)
  // })
}
