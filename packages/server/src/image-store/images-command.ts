/**
 * @module image-store/images-command
 * The `images` command line: `export`, `verify`, `import`, `gc`, `copy` and `resanitize`.
 *
 * `bin/images.ts` only hands `process.argv` to {@link runImagesCommand} and sets the exit code
 * from what it returns. Parsing and dispatch live here so they can be tested.
 */
import { appendFileSync } from 'node:fs'
import yargs from 'yargs'
import config from '../../config'
import { copyBlobs, DEFAULT_COPY_CONCURRENCY, type CopySummary } from './copy'
import { resanitizeImages, type ResanitizeSummary } from './resanitize'
import { createBlobStoreFromSpec } from './store-config'
import { collectGarbage, DEFAULT_GRACE_PERIOD_MS, type GarbageCollectionSummary } from './garbage-collection'
import {
  DEFAULT_BATCH_SIZE,
  exportImages,
  importImages,
  verifyImages,
  type ExportSummary,
  type ImportSummary,
  type VerifySummary,
} from './backfill'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/** The operations the command runs. Tests pass fakes. */
export type ImagesOperations = {
  exportImages: (options: { batchSize: number; sleepMs: number }) => Promise<ExportSummary>
  verifyImages: (options: { rehash: boolean }) => Promise<VerifySummary>
  importImages: (options: { batchSize: number; sleepMs: number }) => Promise<ImportSummary>
  collectGarbage: (options: { dryRun: boolean; gracePeriodMs: number }) => Promise<GarbageCollectionSummary>
  copyImages: (options: { from: string; to: string; concurrency: number }) => Promise<CopySummary>
  resanitizeImages: (options: {
    dryRun: boolean
    batchSize: number
    sleepMs: number
    onRewritten?: (imageHash: string) => void
  }) => Promise<ResanitizeSummary>
}

/** Where the command's output and errors go. Tests collect them. */
export type ImagesCommandOutput = {
  print: (text: string) => void
  printError: (text: string) => void
}

const realOperations: ImagesOperations = {
  exportImages: (options) => exportImages(options),
  verifyImages: (options) => verifyImages(options),
  importImages: (options) => importImages(options),
  collectGarbage: (options) => collectGarbage(options),
  resanitizeImages: (options) => resanitizeImages(options),
  copyImages: ({ from, to, concurrency }) => {
    const context = { defaultLocalDirectory: config.imageStoreDirectory }
    return copyBlobs({
      from: createBlobStoreFromSpec(from, context),
      to: createBlobStoreFromSpec(to, context),
      concurrency,
    })
  },
}

const realOutput: ImagesCommandOutput = {
  print: (text) => console.log(text),
  printError: (text) => console.error(text),
}

/**
 * Runs one `images` command.
 *
 * Each command prints its summary as JSON on standard output. The return value is the process
 * exit code: 0 on success, 1 when `verify` finds a problem, when the arguments are wrong, or when
 * an operation throws.
 *
 * @param args The arguments after the program name, for example `['gc', '--no-dry-run']`.
 * @param dependencies Replaceable operations and output, for tests.
 * @returns The exit code.
 */
export async function runImagesCommand(
  args: string[],
  dependencies: {
    operations?: ImagesOperations
    output?: ImagesCommandOutput
    /** Adds one line to a file. Tests pass a fake; by default it appends to the file on disk. */
    appendLine?: (path: string, line: string) => void
  } = {},
): Promise<number> {
  const {
    operations = realOperations,
    output = realOutput,
    appendLine = (path, line) => appendFileSync(path, `${line}\n`),
  } = dependencies
  let exitCode = 0
  const report = (summary: object) => output.print(JSON.stringify(summary, null, 2))

  const batchOptions = (command: ReturnType<typeof yargs>) =>
    command
      .option('batch-size', {
        type: 'number',
        default: DEFAULT_BATCH_SIZE,
        describe: 'rows read per batch; each row is held in memory until its batch ends',
      })
      .option('sleep-ms', {
        type: 'number',
        default: 0,
        describe: 'pause between batches, so the database keeps room for its other work',
      })

  try {
    await yargs(args)
      .scriptName('images')
      .exitProcess(false)
      .strict()
      .demandCommand(1, 'name a command: export, verify, import, gc, copy or resanitize')
      .command(
        'export',
        'copy the bytes of every image row into the image store and record digest and length; safe to stop and repeat',
        batchOptions,
        async (argv) => {
          report(
            await operations.exportImages({
              batchSize: argv['batch-size'] as number,
              sleepMs: argv['sleep-ms'] as number,
            }),
          )
        },
      )
      .command(
        'verify',
        'check that every row has its bytes in the store; exits 1 when anything is wrong',
        (command) =>
          command.option('rehash', {
            type: 'boolean',
            default: false,
            describe: 'read every file and hash it, instead of trusting its name and length',
          }),
        async (argv) => {
          const summary = await operations.verifyImages({ rehash: argv.rehash as boolean })
          report(summary)
          if (!summary.ok) exitCode = 1
        },
      )
      .command(
        'import',
        'rollback: put bytes back into the database for rows that have them only in the store',
        batchOptions,
        async (argv) => {
          report(
            await operations.importImages({
              batchSize: argv['batch-size'] as number,
              sleepMs: argv['sleep-ms'] as number,
            }),
          )
        },
      )
      .command(
        'gc',
        'remove store files that no row names and that are older than the grace period; a dry run unless --no-dry-run',
        (command) =>
          command
            .option('dry-run', {
              type: 'boolean',
              default: true,
              describe: 'report what would be removed and remove nothing; pass --no-dry-run to remove',
            })
            .option('grace-days', {
              type: 'number',
              default: DEFAULT_GRACE_PERIOD_MS / MILLISECONDS_PER_DAY,
              describe: 'keep an unreferenced file younger than this many days',
            }),
        async (argv) => {
          report(
            await operations.collectGarbage({
              dryRun: argv['dry-run'] as boolean,
              gracePeriodMs: (argv['grace-days'] as number) * MILLISECONDS_PER_DAY,
            }),
          )
        },
      )
      .command(
        'copy',
        "copy every blob from one store to another, checking each one's sha256; safe to stop and repeat; exits 1 on any problem",
        (command) =>
          command
            .option('from', {
              type: 'string',
              demandOption: true,
              describe: 'the source store: a kind name such as s3, or JSON (see IMAGE_STORE)',
            })
            .option('to', {
              type: 'string',
              demandOption: true,
              describe: 'the destination store, in the same form',
            })
            .option('concurrency', {
              type: 'number',
              default: DEFAULT_COPY_CONCURRENCY,
              describe: 'blobs copied at once',
            }),
        async (argv) => {
          const summary = await operations.copyImages({
            from: argv.from as string,
            to: argv.to as string,
            concurrency: argv.concurrency as number,
          })
          report(summary)
          if (!summary.ok) exitCode = 1
        },
      )
      .command(
        'resanitize',
        'run the current vector image sanitizer over stored vector images and rewrite those that change; a dry run unless --no-dry-run; never deletes a file; lists the rewritten image hashes (also to --changed-list) so their cached addresses can be dropped; exits 1 when a row is refused or a file is missing',
        (command) =>
          batchOptions(command)
            .option('dry-run', {
              type: 'boolean',
              default: true,
              describe: 'report what would change and change nothing; pass --no-dry-run to rewrite',
            })
            .option('changed-list', {
              type: 'string',
              describe:
                'file that gets the image hash of each rewritten row, one per line, as it is rewritten; ask the edge cache to drop /image/direct/<hash> for each',
            }),
        async (argv) => {
          const changedList = argv['changed-list'] as string | undefined
          const summary = await operations.resanitizeImages({
            dryRun: argv['dry-run'] as boolean,
            batchSize: argv['batch-size'] as number,
            sleepMs: argv['sleep-ms'] as number,
            ...(changedList ? { onRewritten: (imageHash: string) => appendLine(changedList, imageHash) } : {}),
          })
          report(summary)
          if (!summary.ok) exitCode = 1
        },
      )
      .parseAsync()
  } catch (error) {
    output.printError(error instanceof Error ? error.message : String(error))
    return 1
  }
  return exitCode
}
