import * as collect from '../collect'
import * as args from '../args'
import { cleanup } from '../cleanup'
import * as db from '../db'
import { setDoesRender } from '../log/App'
import _ from 'lodash'
const { providers, logger, concurrency } = args.collect()

setDoesRender(logger === 'terminal')

async function runCollect() {
  const providerList = providers()
  console.log('collect config: %o', {
    providers: providerList,
    logger,
    concurrency,
    count: providerList.length,
  })
  try {
    const dbInstance = db.getDB()
    await dbInstance.migrate.latest()
    await db.purgeExpiredCache().catch(_.noop)
    await collect.main(providerList, logger, concurrency)
  } catch (err) {
    console.error('Collection failed:', err)
  } finally {
    await cleanup()
  }
}

runCollect()
