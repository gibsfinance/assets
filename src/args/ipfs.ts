import { parse } from '@/args/utils'
import _ from 'lodash'

/**
 * Main collection configuration parser
 * @return Parsed and validated configuration object
 */
export const ipfs = _.memoize(() => {
  // updateStatus({
  //   provider: 'system',
  //   message: '⚙️ Parsing command line arguments...',
  //   phase: 'setup',
  // })
  const argv = parse('ipfs', {
    ipfs: {
      type: 'array',
      describe: 'the ipfs gateway to when none is provided',
      required: false,
      default: ['https://ipfs.io/ipfs/', 'https://cloudflare-ipfs.com/ipfs/'],
      coerce: (vals: string[]) => vals.flatMap((v) => v.split(',')),
    },
  })

  // updateStatus({
  //   provider: 'system',
  //   message: '✨ Arguments parsed successfully!',
  //   phase: 'complete',
  // })
  // process.stdout.write('\n')
  return {
    ipfs: argv.ipfs,
  }
})
