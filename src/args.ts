import { hideBin } from 'yargs/helpers'
import { collectables, Collectable } from '@/collect/collectables'
import yargs from 'yargs'

export const collect = () => {
  const argv = yargs(hideBin(process.argv)).options({
    providers: {
      type: 'array',
      describe: 'a list of providers to collect',
      required: false,
    },
  }).parseSync()
  const providers = (argv.providers?.length ? argv.providers : Object.keys(collectables)) as Collectable[]
  return {
    providers,
  }
}

export const exportImage = () => {
  const argv = yargs(hideBin(process.argv)).options({
    token: {
      type: 'string',
      describe: 'the hash of the token',
      required: true,
    },
    chainId: {
      type: 'number',
      describe: 'the chain id to check',
      required: true,
    },
  }).parseSync()
  return {
    token: argv.token,
    chainId: argv.chainId,
  }
}
