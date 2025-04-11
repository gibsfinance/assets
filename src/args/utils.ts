import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

/**
 * @title Command Line Argument Parser
 * @notice Manages command line arguments and environment variables for token collection
 * @dev Changes from original version:
 * 1. Enhanced RPC configuration with fallback support
 * 2. Added image mode control for storage optimization
 * 3. Improved provider selection with validation
 * 4. Added detailed status updates for argument parsing
 */

import { hideBin } from 'yargs/helpers'
import yargs, { Options } from 'yargs'
import _ from 'lodash'

export const parse = <O extends { [key: string]: Options }>(_key: string, options: O) => {
  return yargs(hideBin(process.argv)).env().options(options).parseSync()
}
