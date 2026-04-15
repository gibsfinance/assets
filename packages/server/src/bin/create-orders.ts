import { migrate } from '../db/drizzle'
import { syncDefaultOrder, buildManifestsFromDB } from '../db/sync-order'
import { allCollectables } from '../collect/collectables'
import { cleanup } from '../cleanup'

migrate()
  .then(async () => {
    const keys = allCollectables()
    const manifests = await buildManifestsFromDB(keys)
    await syncDefaultOrder(keys, manifests)
  })
  .catch((err: unknown) => {
    console.error(err)
  })
  .then(cleanup)
