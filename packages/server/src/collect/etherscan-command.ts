/**
 * @module collect/etherscan-command
 *
 * The `etherscan` operator command. One command today, `check`: ask Etherscan which chains and
 * endpoints the configured key may use, and print the answer.
 *
 * `bin/etherscan.ts` only hands `process.argv` to {@link runEtherscanCommand} and sets the exit
 * code from what it returns. The parsing and the printing live here so they can be tested.
 *
 *   node --import ./src/bin/register-hooks.ts ./src/bin/etherscan.ts check
 *
 * The key is read from `ETHERSCAN_API_KEY` by `config.ts`. It is never a command line argument,
 * because arguments show in process lists and shell history.
 */
import yargs from 'yargs'
import config from '../../config'
import {
  formatCapabilityReport,
  NEEDED_ENDPOINTS,
  createClientFromSettings,
  probeConfiguredKey,
  usableChains,
  type EtherscanCapabilityReport,
} from './etherscan-capability'
import type { EtherscanSettings } from './etherscan-settings'

/** Where the command's output and errors go. Tests collect them. */
export type EtherscanCommandOutput = {
  print: (text: string) => void
  printError: (text: string) => void
}

/** What the command needs from its surroundings. Tests replace both. */
export type EtherscanCommandDependencies = {
  settings?: EtherscanSettings
  probe?: (settings: EtherscanSettings) => Promise<EtherscanCapabilityReport>
  output?: EtherscanCommandOutput
}

const realOutput: EtherscanCommandOutput = {
  print: (text) => console.log(text),
  printError: (text) => console.error(text),
}

/**
 * Run one `etherscan` command.
 *
 * `check` prints a row per chain and endpoint, then the usable chains. It exits 0 when at least one
 * chain can be collected and 1 when none can (no key, a refused key, or a plan without the
 * endpoint), so a deploy script can gate on it. Arguments that do not parse also give 1.
 *
 * @param args The arguments after the program name, for example `['check']`.
 * @param dependencies Replaceable settings, probe and output, for tests.
 * @returns The exit code.
 */
export async function runEtherscanCommand(
  args: string[],
  dependencies: EtherscanCommandDependencies = {},
): Promise<number> {
  const {
    settings = config.etherscan,
    probe = (current: EtherscanSettings) =>
      probeConfiguredKey({ settings: current, client: createClientFromSettings(current) }),
    output = realOutput,
  } = dependencies
  let exitCode = 0
  try {
    await yargs(args)
      .scriptName('etherscan')
      .exitProcess(false)
      .strict()
      .demandCommand(1, 'name a command: check')
      .command(
        'check',
        'ask Etherscan which chains and endpoints the configured key can use; exits 1 when none can be collected',
        (command) => command,
        async () => {
          const report = await probe(settings)
          output.print(formatCapabilityReport(report, NEEDED_ENDPOINTS).join('\n'))
          if (usableChains(report, NEEDED_ENDPOINTS).length === 0) exitCode = 1
        },
      )
      .parseAsync()
  } catch (error) {
    output.printError(error instanceof Error ? error.message : String(error))
    return 1
  }
  return exitCode
}
