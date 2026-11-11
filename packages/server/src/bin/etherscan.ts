/**
 * Operator command for the Etherscan collector: `check`.
 * See `collect/etherscan-command.ts` for what it does; this file only wires it to the process.
 *
 *   node --import ./src/bin/register-hooks.ts ./src/bin/etherscan.ts check
 */
import { runEtherscanCommand } from '../collect/etherscan-command'

runEtherscanCommand(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
