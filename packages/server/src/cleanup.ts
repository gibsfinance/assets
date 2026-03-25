import * as db from './db'
import { cancelAllRequests } from '@gibs/utils/fetch'
import * as utils from './utils'
import { destroyTerminal } from './log/App'

export const cleanup = async () => {
  try {
    await db.getDB().destroy()
  } catch {
    // Knex instance may not have been initialized — safe to ignore
  }
  utils.printFailures()
  cancelAllRequests()
  destroyTerminal()
}
