import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

import { hideBin } from 'yargs/helpers'
import yargs, { Options } from 'yargs'
import _ from 'lodash'

export const parse = <O extends { [key: string]: Options }>(_key: string, options: O) => {
  return yargs(hideBin(process.argv)).env().options(options).parseSync()
}
