/**
 * @module submodule-refresh
 * Keeps the vendored artwork repositories small and current.
 *
 * Four collectors read artwork straight off disk from `submodules/<name>/…`
 * (see `submodule-source.ts` for why the address recorded for each file is
 * public rather than local). This module owns how those directories get there:
 *
 * - A full `git clone` carries years of history the collectors never read.
 *   Trust Wallet alone is 703 MB of history behind 500 MB of files. Here every
 *   checkout is depth 1, with file contents fetched on demand (`--filter=blob:none`)
 *   and only the directories a collector walks checked out (sparse checkout).
 * - A copy baked into an image goes stale the day after the build. The collector
 *   calls `refreshSubmodulesForProviders` at the start of every run, which fetches
 *   the newest commit of each repository it is about to read. If the network is down
 *   the copy already on disk is kept and the run goes on with it.
 *
 * This file has no relative imports at run time (its one `import type` is erased) and uses
 * only syntax Node strips natively, on purpose: `scripts/refresh-submodules.mjs` runs it during an image build, in a
 * stage that has no installed dependencies. Keep it that way. Every command is run
 * through an injected `CommandRunner`, so the decisions below are tested without a
 * network.
 *
 * Sizes and the directory list are facts about the collectors. If a collector starts
 * reading another directory, add it to `sparsePaths` here, or it will find the
 * directory empty.
 */
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Collectable } from './collect/collectables'

/** One vendored repository: where it comes from and which part of it is read. */
export type SubmoduleSpec = {
  /** Directory name under the submodules directory (`.gitmodules` `path`, minus the prefix). */
  readonly name: string
  /** Address git clones from. */
  readonly url: string
  /** Branch to follow. */
  readonly branch: string
  /** The only directories (relative to the repository root) a collector reads. */
  readonly sparsePaths: readonly string[]
}

/**
 * Every vendored repository. Names, addresses and branches must match
 * `SUBMODULE_REPOSITORIES` in `submodule-source.ts` and `.gitmodules`; a test holds them together.
 * `sparsePaths` come from what each collector walks:
 * `trustwallet.ts` reads `blockchains/`, `smoldapp.ts` reads `tokens/` and `chains/`,
 * `pls369.ts` walks `blockchain/pulsechain/assets/`, `ethereum-lists.ts` reads `tokens/`.
 */
export const SUBMODULE_SPECS: readonly SubmoduleSpec[] = Object.freeze([
  {
    name: 'trustwallet',
    url: 'https://github.com/trustwallet/assets',
    branch: 'master',
    sparsePaths: ['blockchains'],
  },
  {
    name: 'smoldapp-tokenassets',
    url: 'https://github.com/SmolDapp/tokenAssets.git',
    branch: 'main',
    sparsePaths: ['tokens', 'chains'],
  },
  {
    name: 'ethereum-lists-tokens',
    url: 'https://github.com/ethereum-lists/tokens',
    branch: 'master',
    sparsePaths: ['tokens'],
  },
  {
    name: 'pulsechain-assets',
    url: 'https://github.com/PLS369/pulsechain-assets',
    branch: 'main',
    sparsePaths: ['blockchain/pulsechain/assets'],
  },
])

/** The provider keys that read each repository from disk, keyed by the repository's directory name. */
export const SUBMODULE_PROVIDER_KEYS: Readonly<Record<string, Collectable>> = Object.freeze({
  trustwallet: 'trustwallet',
  'smoldapp-tokenassets': 'smoldapp',
  'ethereum-lists-tokens': 'ethereum-lists',
  'pulsechain-assets': 'pls369',
})

/** Runs one command and resolves when it exits with status zero; rejects otherwise. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<void>

/** Everything the refresh touches outside plain computation. */
export type RefreshDependencies = {
  /** Runs `git`. */
  readonly runCommand: CommandRunner
  /** Whether a file or directory exists. */
  readonly pathExists: (target: string) => Promise<boolean>
  /** Deletes a directory tree. Resolves when it is gone or never existed. */
  readonly removeDirectory: (target: string) => Promise<void>
  /** Moves a directory. */
  readonly renameDirectory: (from: string, to: string) => Promise<void>
  /** Creates a directory and any missing parents. */
  readonly makeDirectory: (target: string) => Promise<void>
  /** Resolves after the given number of milliseconds. */
  readonly wait: (milliseconds: number) => Promise<void>
  /** Reports progress. */
  readonly log: (message: string) => void
}

/**
 * What happened to one repository.
 * - `cloned`: there was no checkout, and a new one was made.
 * - `updated`: the existing checkout moved to the newest commit.
 * - `kept`: the refresh failed and the checkout already on disk was left as it was.
 * - `missing`: the refresh failed and there is nothing on disk to fall back to.
 */
export type RefreshAction = 'cloned' | 'updated' | 'kept' | 'missing'

/** The result for one repository. */
export type RefreshOutcome = {
  readonly name: string
  readonly action: RefreshAction
  /** Why the refresh failed. Present for `kept` and `missing`. */
  readonly reason?: string
}

/** Attempts a network step gets before the refresh gives up on a repository. */
export const REFRESH_ATTEMPTS = 3

/** Wait between attempts, in milliseconds. */
export const REFRESH_RETRY_DELAY_MS = 2_000

/** Longest a single git command may run, in milliseconds. A stalled fetch must not hold a collection run forever. */
export const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000

/**
 * The specs for the repositories a set of providers reads from disk, in `SUBMODULE_SPECS` order.
 * A provider that reads nothing from disk adds nothing, so a run of one remote list
 * does not touch the network for artwork it will not read.
 * @param providerKeys The provider keys a collection run will collect.
 */
export const specsForProviders = (providerKeys: readonly string[]): readonly SubmoduleSpec[] =>
  SUBMODULE_SPECS.filter((spec) => providerKeys.includes(SUBMODULE_PROVIDER_KEYS[spec.name]))

/**
 * The shallow, sparse clone commands for one repository.
 * `--filter=blob:none` leaves file contents on the server until a checkout needs them,
 * and the sparse checkout means only the directories in `sparsePaths` are ever needed.
 * @param spec The repository.
 * @param target Where to clone to.
 */
export const cloneCommands = (spec: SubmoduleSpec, target: string): readonly (readonly string[])[] => [
  [
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--no-tags',
    '--sparse',
    '--single-branch',
    '--branch',
    spec.branch,
    spec.url,
    target,
  ],
  ['-C', target, 'sparse-checkout', 'set', ...spec.sparsePaths],
]

/**
 * The commands that move an existing checkout to the newest commit of its branch.
 * The fetch is the only step that needs the network. Re-stating the sparse paths keeps
 * a checkout made before a path was added in step with `sparsePaths`. The last step
 * drops the previous commit, which depth 1 leaves behind as unreachable data; without
 * it a checkout would grow by roughly one working tree per refresh.
 * @param spec The repository.
 * @param target The existing checkout.
 */
export const updateCommands = (
  spec: SubmoduleSpec,
  target: string,
): { readonly fetch: readonly string[]; readonly apply: readonly (readonly string[])[] } => ({
  fetch: ['-C', target, 'fetch', '--depth', '1', '--filter=blob:none', '--no-tags', 'origin', spec.branch],
  apply: [
    ['-C', target, 'sparse-checkout', 'set', ...spec.sparsePaths],
    ['-C', target, 'reset', '--hard', 'FETCH_HEAD'],
    ['-C', target, '-c', 'gc.reflogExpire=now', '-c', 'gc.reflogExpireUnreachable=now', 'gc', '--prune=now', '--quiet'],
  ],
})

/**
 * Whether a directory holds a checkout this module can update.
 * A directory with no `.git` entry is not one: it may be an empty mount point, or a
 * copy somebody unpacked by hand. Either way it is replaced, not updated.
 */
const hasCheckout = (dependencies: RefreshDependencies, target: string): Promise<boolean> =>
  dependencies.pathExists(path.join(target, '.git'))

/** Runs a network step up to `REFRESH_ATTEMPTS` times and rethrows the last failure. */
const withRetries = async (dependencies: RefreshDependencies, step: () => Promise<void>): Promise<void> => {
  let lastError: unknown
  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt++) {
    try {
      return await step()
    } catch (error) {
      lastError = error
      if (attempt < REFRESH_ATTEMPTS) await dependencies.wait(REFRESH_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

/**
 * Runs a list of git commands in order, stopping at the first failure.
 * @param dependencies The injected effects.
 * @param commands Argument lists for `git`.
 */
const runGit = async (dependencies: RefreshDependencies, commands: readonly (readonly string[])[]): Promise<void> => {
  for (const args of commands) await dependencies.runCommand('git', args)
}

/**
 * Makes a fresh checkout next to its final place and moves it in only once it is complete.
 * A clone that dies halfway therefore never leaves a directory that looks usable.
 */
const cloneInto = async (dependencies: RefreshDependencies, spec: SubmoduleSpec, target: string): Promise<void> => {
  const staging = `${target}.cloning`
  try {
    await withRetries(dependencies, async () => {
      await dependencies.removeDirectory(staging)
      await runGit(dependencies, cloneCommands(spec, staging))
    })
  } catch (error) {
    await dependencies.removeDirectory(staging)
    throw error
  }
  await dependencies.removeDirectory(target)
  await dependencies.renameDirectory(staging, target)
}

/**
 * Moves an existing checkout to the newest commit. Only the fetch is retried: the
 * steps after it work on local data, so a failure there repeats on every attempt.
 */
const updateIn = async (dependencies: RefreshDependencies, spec: SubmoduleSpec, target: string): Promise<void> => {
  const { fetch, apply } = updateCommands(spec, target)
  await withRetries(dependencies, () => dependencies.runCommand('git', fetch))
  await runGit(dependencies, apply)
}

/** The text of a thrown value, for a log line. */
const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Refreshes one repository, and never throws.
 * A failure is reported in the outcome, because a stale copy is better for a collection
 * run than no run.
 * @param dependencies The injected effects.
 * @param directory The submodules directory; the repository goes in `<directory>/<name>`.
 * @param spec The repository.
 */
export const refreshSubmodule = async (
  dependencies: RefreshDependencies,
  directory: string,
  spec: SubmoduleSpec,
): Promise<RefreshOutcome> => {
  const target = path.join(directory, spec.name)
  const existing = await hasCheckout(dependencies, target)
  const action = existing ? 'updated' : 'cloned'
  try {
    await dependencies.makeDirectory(directory)
    if (existing) {
      await updateIn(dependencies, spec, target)
    } else {
      await cloneInto(dependencies, spec, target)
    }
    dependencies.log(`submodule ${spec.name}: ${action}`)
    return { name: spec.name, action }
  } catch (error) {
    const reason = describeError(error)
    // A failed update leaves the old files in place. A failed first clone leaves
    // nothing, unless a directory without git metadata (an unpacked copy) was already there.
    const usable = existing || (await dependencies.pathExists(target))
    const failedAction = usable ? 'kept' : 'missing'
    dependencies.log(`submodule ${spec.name}: refresh failed (${reason}); ${failedAction}`)
    return { name: spec.name, action: failedAction, reason }
  }
}

/**
 * Refreshes several repositories one after another. One at a time, because they share
 * a network link and the peak memory of a git fetch is not worth stacking.
 * @param dependencies The injected effects.
 * @param directory The submodules directory.
 * @param specs The repositories to refresh.
 */
export const refreshSubmodules = async (
  dependencies: RefreshDependencies,
  directory: string,
  specs: readonly SubmoduleSpec[] = SUBMODULE_SPECS,
): Promise<readonly RefreshOutcome[]> => {
  const outcomes: RefreshOutcome[] = []
  for (const spec of specs) outcomes.push(await refreshSubmodule(dependencies, directory, spec))
  return outcomes
}

/**
 * Whether every repository ended with something to read. `missing` is the only
 * outcome that is not: the collector for it will find an empty directory.
 */
export const everyRepositoryPresent = (outcomes: readonly RefreshOutcome[]): boolean =>
  outcomes.every((outcome) => outcome.action !== 'missing')

/**
 * Whether the collector should refresh the repositories itself. Off unless
 * `REFRESH_SUBMODULES` is `true`: on a development machine the directories are
 * git submodules somebody may be working in, and a hard reset would discard that work.
 * The worker image turns it on.
 * @param value The value of the `REFRESH_SUBMODULES` environment variable.
 */
export const isRefreshEnabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === 'true'

/**
 * The real effects: `git` from the path, the real file system, and the real clock.
 * Git never prompts for credentials, because the repositories are public and a prompt
 * would hang an unattended run.
 * @param log Where progress lines go.
 */
export const createSystemDependencies = (log: (message: string) => void): RefreshDependencies => ({
  runCommand: (command, args) =>
    new Promise<void>((resolve, reject) => {
      execFile(
        command,
        [...args],
        { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: COMMAND_TIMEOUT_MS },
        (error) => (error ? reject(error) : resolve()),
      )
    }),
  pathExists: (target) =>
    fs.promises.access(target).then(
      () => true,
      () => false,
    ),
  removeDirectory: (target) => fs.promises.rm(target, { recursive: true, force: true }),
  renameDirectory: (from, to) => fs.promises.rename(from, to),
  makeDirectory: async (target) => {
    await fs.promises.mkdir(target, { recursive: true })
  },
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log,
})

/**
 * The entry the collector calls at the start of a run: refresh the repositories the
 * selected providers read, using the system for everything.
 * @param directory The submodules directory.
 * @param providerKeys The provider keys the run will collect.
 * @param log Where progress lines go.
 */
export const refreshSubmodulesForProviders = (
  directory: string,
  providerKeys: readonly string[],
  log: (message: string) => void,
): Promise<readonly RefreshOutcome[]> =>
  refreshSubmodules(createSystemDependencies(log), directory, specsForProviders(providerKeys))
