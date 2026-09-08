import * as collect from '../collect'
import * as args from '../args'
import { cleanup } from '../cleanup'
import * as db from '../db'
import { setDoesRender } from '../log/App'
import { startMemoryReporting } from '../server/memory'
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
  // This job runs several providers at once, each buffering remote lists and images, and
  // it has never reported what that costs. The closing reading in `finally` is the one
  // worth reading: it carries the peak across the whole run, including the stretch after
  // the last tick, which is where a batch job usually finishes its heaviest work.
  const memory = startMemoryReporting()
  try {
    await db.migrate()
    await db.purgeExpiredCache().catch(_.noop)
    await collect.main(providerList, logger, concurrency)
  } catch (err) {
    console.error('Collection failed:', err)
  } finally {
    memory.stop()
    memory.reportNow()
    await cleanup()
  }
}

runCollect()
