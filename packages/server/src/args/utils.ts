import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

import { hideBin } from 'yargs/helpers'
import yargs, { Options } from 'yargs'

export const parse = <O extends Record<string, Options>>(_key: string, options: O) => {
  return yargs(hideBin(process.argv)).env().options(options).parseSync()
}
