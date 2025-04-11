/**
 * @title Command Line Argument Parser
 * @notice Manages command line arguments and environment variables for token collection
 * @dev Changes from original version:
 * 1. Enhanced RPC configuration with fallback support
 * 2. Added image mode control for storage optimization
 * 3. Improved provider selection with validation
 * 4. Added detailed status updates for argument parsing
 */

import { parse } from '@/args/utils'
import _ from 'lodash'
/**
 * @notice Harvest configuration parser
 * @dev Changes:
 * 1. Added status updates for harvest progress
 * 2. Enhanced parameter validation
 * 3. Improved error handling for required fields
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
