import { cancelAllRequests } from '@gibs/utils/fetch'
import * as utils from './utils'
import { destroyTerminal } from './log/App'

export const cleanup = async () => {
  utils.printFailures()
  cancelAllRequests()
  destroyTerminal()
}
