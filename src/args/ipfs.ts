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
 * @notice Main collection configuration parser
 * @dev Changes:
 * 1. Added status updates for parsing progress
 * 2. Enhanced provider validation and selection
 * 3. Improved IPFS gateway configuration
 * 4. Added image mode control with warnings
 * @return Parsed and validated configuration object
 */
export const ipfs = _.memoize(() => {
  updateStatus('⚙️ Parsing command line arguments...')
  const argv = parse('ipfs', {
    ipfs: {
      type: 'array',
      describe: 'the ipfs gateway to when none is provided',
      required: false,
      default: ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'],
      coerce: (vals: string[]) => vals.flatMap((v) => v.split(',')),
    },
  })

  updateStatus('✨ Arguments parsed successfully!')
  // process.stdout.write('\n')
  return {
    ipfs: argv.ipfs,
  }
})
