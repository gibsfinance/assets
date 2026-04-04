import * as harvest from '../harvest'
import * as db from '../db'
import { cleanup } from '../cleanup'
import { harvest as harvestArgs } from '../args/harvest'
import { syncDefaultOrder, buildManifestsFromDB } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
const arg = harvestArgs()

db.migrate()
  .then(() => harvest.main(arg))
  .then(async () => {
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
  })
  .catch((err) => console.log(err))
  .then(cleanup)
