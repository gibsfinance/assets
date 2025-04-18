import { parse } from '@/args/utils'
import _ from 'lodash'

// import { updateStatus } from '@/log/App'

/**
 * Image export configuration parser
 * @return Parsed image export configuration
 */
export const exportImage = _.memoize(() => {
  // updateStatus({
  //   provider: 'system',
  //   message: '⚙️ Parsing image export arguments...',
  //   phase: 'setup',
  // })
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
  // updateStatus({
  //   provider: 'system',
  //   message: '✨ Image export arguments parsed!',
  //   phase: 'complete',
  // })
  // process.stdout.write('\n')
  return {
    token: argv.token,
    chainId: argv.chainId,
  }
})
