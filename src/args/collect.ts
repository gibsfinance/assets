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

import { type Collectable, allCollectables } from '@/collect/collectables'
import type { ImageModeParam } from '@/types'
import { imageMode } from '@/db/tables'
import { updateStatus } from '@/utils'

/**
 * @notice RPC configuration helper for chain endpoints
 * @dev Changes:
 * 1. Added array type support for multiple RPC endpoints
 * 2. Enhanced coercion for comma-separated values
 * 3. Improved default handling with environment fallbacks
 * @param chain The chain name for documentation
 * @return Yargs option configuration object
 */
const rpc = (chain: string, defaultUrl?: string) => {
  return {
    type: 'array',
    describe: `the rpc url for ${chain}`,
    required: false,
    default: defaultUrl ? [defaultUrl] : [],
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
  const argv = parse('collect', {
    providers: {
      type: 'array',
      describe: 'a list of providers to collect',
      required: false,
      coerce: (vals: string[]) => vals.flatMap((v) => v.split(',')),
    },
    mode: {
      type: 'string',
      describe: 'how to link and treat images - should they be saved or simply linked to',
      required: false,
      default: 'mixed',
      choices: ['mixed', 'save', 'link'],
    },
    rpc1: rpc('ethereum', 'https://rpc-ethereum.g4mm4.io'),
    rpc369: rpc('pulsechain', 'https://rpc-pulsechain.g4mm4.io'),
    rpc56: rpc('bsc'),
    rpc11155111: rpc('sepolia', 'https://ethereum-sepolia-rpc.publicnode.com'),
    rpc943: rpc('pulsechainv4', 'https://rpc-testnet-pulsechain.g4mm4.io'),
  })

  // because of the cirulcar dependency, this is how this is currently done
  // get rid of the circular dependency and then you can get rid of this
  const providers = argv.providers?.length ? () => (argv.providers || []) as Collectable[] : () => allCollectables()
  if (argv.mode === 'save') {
    updateStatus('⚠️ Warning: saving all images - this could collect unwanted data')
  }
  updateStatus('✨ Arguments parsed successfully!')
  return {
    providers,
    mode: argv.mode as ImageModeParam,
    rpc1: argv.rpc1,
    rpc369: argv.rpc369,
    rpc56: argv.rpc56,
    rpc11155111: argv.rpc11155111,
    rpc943: argv.rpc943,
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
