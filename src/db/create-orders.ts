import { tableNames } from '@/db/tables'
import * as db from '@/db'

// this is out of the seed folder because it has to be run after
// providers and lists are seeded by the worker. can't be done in 1 tx
export async function seedOrders(): Promise<void> {
  await db.transaction(async (trx) => {
    const pulsechainProvider = await db.insertProvider(
      {
        key: 'pulsechain',
        name: 'PulseChain',
        description: 'a grass roots list curated by pulsechain devs',
      },
      trx,
    )
    if (!pulsechainProvider) {
      throw new Error('Failed to insert pulsechain provider')
    }
    const providerIds = [
      db.ids.provider('gibs'),
      db.ids.provider('balancer'),
      db.ids.provider('piteas'),
      db.ids.provider('internetmoney'),
      db.ids.provider('pulsechain'),
    ]
    const providers = await db.getDB().select('*').from(tableNames.provider).whereIn('providerId', providerIds)
    if (providers.length !== providerIds.length) {
      throw new Error('Failed to insert providers')
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
      trx,
    )
    await db.insertOrder(
      {
        providerId: db.ids.provider('pulsechain'),
        type: 'scan',
        key: 'scan',
      },
      [
        {
          providerId: db.ids.provider('pulsex'),
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
        {
          providerId: db.ids.provider('trustwallet'),
          listKey: 'wallet',
          ranking: 3,
        },
      ],
      trx,
    )
  })
}
