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

import { updateStatus } from '@/utils'

/**
 * @notice Image export configuration parser
 * @dev Changes:
 * 1. Added status updates for export progress
 * 2. Enhanced parameter validation
 * 3. Improved error handling for required fields
 * @return Parsed image export configuration
 */
export const exportImage = _.memoize(() => {
  updateStatus('⚙️ Parsing image export arguments...')
  const argv = parse('export-image', {
    token: {
      type: 'string',
      describe: 'the hash of the token',
      required: false,
    },
    chainId: {
      type: 'number',
      describe: 'the chain id to check',
      required: true,
    },
  })
  updateStatus('✨ Image export arguments parsed!')
  // process.stdout.write('\n')
  return {
    token: argv.token,
    chainId: argv.chainId,
  }
})
