import { collect } from '@/collect/trustwallet'
import * as db from '@/db'

collect().catch((err) => console.log(err))
  .then(async () => {
    await db.getDB().destroy()
  })
