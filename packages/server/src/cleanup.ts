import * as db from './db'
import { cancelAllRequests } from '@gibs/utils/fetch'
import * as utils from './utils'
import { destroyTerminal } from './log/App'

export const cleanup = async () => {
  await db.getDB().destroy()
  utils.printFailures()
  cancelAllRequests()
  destroyTerminal()
}
