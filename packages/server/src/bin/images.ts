/**
 * Operator command for the image store: `export`, `verify`, `import` and `gc`.
 * See `image-store/images-command.ts` for what each does; this file only wires it to the process.
 *
 *   node --import ./src/bin/register-hooks.ts ./src/bin/images.ts <command> [options]
 */
import { closeDb } from '../db/drizzle'
import { runImagesCommand } from '../image-store/images-command'

runImagesCommand(process.argv.slice(2))
  .then(async (exitCode) => {
    await closeDb()
    process.exitCode = exitCode
  })
  .catch(async (error: unknown) => {
    console.error(error)
    await closeDb().catch(() => undefined)
    process.exitCode = 1
  })
