import * as collect from '@/collect'
import { cleanup } from '@/cleanup'
import * as args from '@/args'

const { providers } = args.collect()

collect
  .main(providers)
  .catch((err) => console.log(err))
  .then(cleanup)
  .then(() => {
    console.log('finished')
  })
