import * as db from '@/db'
import * as fetch from '@/fetch'
import * as utils from '@/utils'

export const cleanup = async () => {
  await db.getDB().destroy()
  utils.printFailures()
  fetch.cancelAllRequests()
}
