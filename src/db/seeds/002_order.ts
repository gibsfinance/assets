import { Knex } from 'knex'
import { tableNames } from '../tables'
import * as db from '@/db'

export async function seed(knex: Knex): Promise<void> {
  const providers = await db
    .getDB()
    .select('*')
    .from(tableNames.provider)
    .whereIn('providerId', [
      db.ids.provider('gibs'),
      db.ids.provider('balancer'),
      db.ids.provider('piteas'),
      db.ids.provider('internetmoney'),
    ])
  if (providers.length !== 4) {
    console.log('skip order seed')
    return
  }
  await db.insertOrder(
    {
      providerId: db.ids.provider('gibs'),
      type: 'default',
      key: 'default',
    },
    [
      {
        providerId: db.ids.provider('balancer'),
        listKey: 'exchange',
        ranking: 0,
      },
      {
        providerId: db.ids.provider('piteas'),
        listKey: 'exchange',
        ranking: 1,
      },
      {
        providerId: db.ids.provider('internetmoney'),
        listKey: 'wallet',
        ranking: 2,
      },
    ],
    knex,
  )
  // await db.insertOrder({
  //   providerId: db.ids.provider('gibs'),
  //   type: 'wallet',
  //   key: 'default',
  // }, [{
  //   providerId: db.ids.provider('trustwallet'),
  //   listKey: 'trustwallet-ethereum',
  //   ranking: 0,
  // }, {
  //   providerId: db.ids.provider('internetmoney'),
  //   listKey: 'default',
  //   ranking: 1,
  // }], knex)
}
