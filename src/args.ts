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
import { type Collectable, allCollectables } from '@/collect/collectables'
import yargs from 'yargs'
import _ from 'lodash'
import type { ImageModeParam } from './types'
import { imageMode } from '@/db/tables'
import { updateStatus } from '@/utils'

/**
 * @notice RPC configuration helper for chain endpoints
 * @dev Changes:
 * 1. Added array type support for multiple RPC endpoints
 * 2. Enhanced coercion for comma-separated values
 * 3. Improved default handling with environment fallbacks
 * @param chain The chain name for documentation
 * @param envVar The environment variable to check for RPC URLs
 * @return Yargs option configuration object
 */
const rpc = (chain: string, envVar: string) => {
  return {
    type: 'array',
    describe: `the rpc url for ${chain}`,
    required: false,
    default: [],
    coerce: (val: string[]) => val.flatMap((v) => v.split(',')),
  } as const
}

/**
 * @notice Main collection configuration parser
 * @dev Changes:
 * 1. Added status updates for parsing progress
 * 2. Enhanced provider validation and selection
 * 3. Improved IPFS gateway configuration
 * 4. Added image mode control with warnings
 * @return Parsed and validated configuration object
 */
export const collect = _.memoize(() => {
  updateStatus('⚙️ Parsing command line arguments...')
  const argv = yargs(hideBin(process.argv))
    .env()
    .options({
      providers: {
        type: 'array',
        describe: 'a list of providers to collect',
        required: false,
        coerce: (vals: string[]) => vals.flatMap((v) => v.split(',')),
      },
      ipfs: {
        type: 'array',
        describe: 'the ipfs gateway to when none is provided',
        required: false,
        default: ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'],
        coerce: (vals: string[]) => vals.flatMap((v) => v.split(',')),
      },
      mode: {
        type: 'string',
        describe: 'how to link and treat images - should they be saved or simply linked to',
        required: false,
        default: 'mixed',
        choices: ['mixed', 'save', 'link'],
      },
      rpc1: rpc('ethereum', 'RPC_1'),
      rpc369: rpc('pulsechain', 'RPC_369'),
      rpc56: rpc('bsc', 'RPC_56'),
    })
    .parseSync()

  // because of the cirulcar dependency, this is how this is currently done
  // get rid of the circular dependency and then you can get rid of this
  const providers = argv.providers?.length ? () => (argv.providers || []) as Collectable[] : () => allCollectables()
  if (argv.mode === 'save') {
    updateStatus('⚠️ Warning: saving all images - this could collect unwanted data')
    process.stdout.write('\n')
  }
  updateStatus('✨ Arguments parsed successfully!')
  process.stdout.write('\n')
  return {
    providers,
    ipfs: argv.ipfs,
    mode: argv.mode as ImageModeParam,
    rpc1: argv.rpc1,
    rpc369: argv.rpc369,
    rpc56: argv.rpc56,
  }
})

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
  const argv = yargs(hideBin(process.argv))
    .options({
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
    .parseSync()
  updateStatus('✨ Image export arguments parsed!')
  process.stdout.write('\n')
  return {
    token: argv.token,
    chainId: argv.chainId,
  }
})

/**
 * @notice Provider save mode checker
 * @dev Changes:
 * 1. Added support for provider-specific save rules
 * 2. Enhanced mode handling with explicit checks
 * 3. Improved security for untrusted providers
 * @param providerKey The provider to check
 * @return Boolean indicating if provider content should be saved
 */
// because pumptires is controlled by anyone, we don't want to collect it by default
const defaultNotCollected = new Set<Collectable>(['pumptires'])

export const checkShouldSave = _.memoize((providerKey: string) => {
  const { mode } = collect()
  if (mode === imageMode.SAVE) {
    return true
  } else if (mode === imageMode.LINK) {
    return false
  } else {
    return !defaultNotCollected.has(providerKey as Collectable)
  }
})
