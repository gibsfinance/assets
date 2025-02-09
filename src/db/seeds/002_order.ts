import { Knex } from 'knex'
import { tableNames } from '../tables'
import * as db from '@/db'

export async function seed(knex: Knex): Promise<void> {
  // const pulsechainProvider = await db.insertProvider(
  //   {
  //     key: 'pulsechain',
  //     name: 'PulseChain',
  //     description: 'a grass roots list curated by pulsechain devs',
  //   },
  //   knex,
  // )
  // const providers = await db
  //   .getDB()
  //   .select('*')
  //   .from(tableNames.provider)
  //   .whereIn('providerId', [
  //     db.ids.provider('gibs'),
  //     db.ids.provider('balancer'),
  //     db.ids.provider('piteas'),
  //     db.ids.provider('internetmoney'),
  //     db.ids.provider('pulsechain'),
  //   ])
  // await db.insertOrder(
  //   {
  //     providerId: db.ids.provider('gibs'),
  //     type: 'default',
  //     key: 'default',
  //   },
  //   [
  //     {
  //       providerId: db.ids.provider('balancer'),
  //       listKey: 'exchange',
  //       ranking: 0,
  //     },
  //     {
  //       providerId: db.ids.provider('piteas'),
  //       listKey: 'exchange',
  //       ranking: 1,
  //     },
  //     {
  //       providerId: db.ids.provider('internetmoney'),
  //       listKey: 'wallet',
  //       ranking: 2,
  //     },
  //   ],
  //   knex,
  // )
  // await db.insertOrder(
  //   {
  //     providerId: db.ids.provider('pulsechain'),
  //     type: 'scan',
  //     key: 'scan',
  //   },
  //   [
  //     {
  //       providerId: db.ids.provider('pulsex'),
  //       listKey: 'exchange',
  //       ranking: 0,
  //     },
  //     {
  //       providerId: db.ids.provider('piteas'),
  //       listKey: 'exchange',
  //       ranking: 1,
  //     },
  //     {
  //       providerId: db.ids.provider('internetmoney'),
  //       listKey: 'wallet',
  //       ranking: 2,
  //     },
  //     {
  //       providerId: db.ids.provider('trustwallet'),
  //       listKey: 'wallet',
  //       ranking: 3,
  //     },
  //   ],
  //   knex,
  // )
}
