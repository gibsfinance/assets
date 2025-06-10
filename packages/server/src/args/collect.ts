import { parse } from './utils'
import _ from 'lodash'

import { type Collectable, allCollectables } from '../collect/collectables'
import type { ImageModeParam } from '../types'
import { imageMode } from '../db/tables'

/**
 * RPC configuration helper for chain endpoints
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
 * Main collection configuration parser
 * @return Parsed and validated configuration object
 */
export const collect = _.memoize(() => {
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
    logger: {
      type: 'string',
      describe: 'the logger to use',
      required: false,
      default: 'terminal',
      choices: ['terminal', 'pretty'],
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
    // updateStatus({
    //   provider: 'system',
    //   message: '⚠️ Warning: saving all images - this could collect unwanted data',
    //   phase: 'setup',
    // })
  }
  // updateStatus({
  //   provider: 'system',
  //   message: '✨ Arguments parsed successfully!',
  //   phase: 'complete',
  // })
  return {
    providers,
    mode: argv.mode as ImageModeParam,
    logger: argv.logger,
    rpc1: argv.rpc1,
    rpc369: argv.rpc369,
    rpc56: argv.rpc56,
    rpc11155111: argv.rpc11155111,
    rpc943: argv.rpc943,
  }
})

/**
 * Provider save mode checker
 * @param providerKey The provider to check
 * @return Boolean indicating if provider content should be saved
 */
// because pumptires is controlled by anyone, we don't want to collect it by default
const defaultNotCollected = new Set<Collectable>(['pumptires', 'dexscreener'] as unknown as Collectable[])

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
