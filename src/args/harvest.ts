import { parse } from '@/args/utils'
import _ from 'lodash'
/**
 * Harvest configuration parser
 */
export const harvest = _.memoize(() => {
  const argv = parse('harvest', {
    coingeckoApiKey: {
      type: 'string',
      describe: 'the coingecko api key',
      required: true,
    },
  })
  return {
    coingeckoApiKey: argv.coingeckoApiKey,
  }
})
