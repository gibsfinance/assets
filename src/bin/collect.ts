import * as collect from '@/collect'
import * as fetch from '@/fetch'
import * as utils from '@/utils'

collect
  .main()
  .catch((err) => console.log(err))
  .then(() => {
    utils.printFailures()
    fetch.cancelAllRequests()
  })
