import { hideBin } from 'yargs/helpers'
import { collectables, type Collectable } from '@/collect/collectables'
import yargs from 'yargs'
import _ from 'lodash'
import { log } from '@/logger'
import { ImageModeParam } from './types'
import { imageMode } from '@/db/tables'

const rpc = (chain: string, url: string) => {
  return {
    type: 'array',
    describe: `the rpc url for ${chain}`,
    required: false,
    default: [url],
    coerce: (val: string[]) => val.flatMap((v) => v.split(',')),
  } as const
}

export const collect = _.memoize(() => {
  const argv = yargs(hideBin(process.argv))
    .env()
    .options({
      providers: {
        type: 'array',
        describe: 'a list of providers to collect',
        required: false,
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
      rpc1: rpc('ethereum', 'https://rpc-ethereum.g4mm4.io'),
      rpc369: rpc('pulsechain', 'https://rpc-pulsechain.g4mm4.io'),
      rpc56: rpc('bsc', 'https://bsc-pokt.nodies.app'),
    })
    .parseSync()
  const providers = (argv.providers?.length ? argv.providers : Object.keys(collectables)) as Collectable[]
  if (argv.mode === 'save') {
    log('warning: saving all images - this could collect unwanted data')
  }
  return {
    providers,
    ipfs: argv.ipfs,
    mode: argv.mode as ImageModeParam,
    rpc1: argv.rpc1,
    rpc369: argv.rpc369,
    rpc56: argv.rpc56,
  }
})

export const exportImage = _.memoize(() => {
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
  return {
    token: argv.token,
    chainId: argv.chainId,
  }
})

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
