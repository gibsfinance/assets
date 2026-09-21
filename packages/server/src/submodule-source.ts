/**
 * @module submodule-source
 * Public, fetchable addresses for artwork vendored as git submodules.
 *
 * Four collectors (`smoldapp.ts`, `trustwallet.ts`, `pls369.ts`, and — for any
 * future local read — `ethereum-lists.ts`) read image bytes from a git submodule
 * checked out on disk under `submodules/<name>/…`. Reading from disk is correct
 * and fast: the whole point of vendoring these repositories is to avoid a
 * network fetch per image. The defect this module fixes is what gets RECORDED
 * as the image's source address. An absolute filesystem path such as
 * `/…/submodules/smoldapp-tokenassets/tokens/1/0x…/logo.svg` means nothing
 * outside this container — a caller reading `x-source-uri` cannot fetch it, so
 * the provenance claim `/terms` makes is unverifiable for exactly these four,
 * top-ranked sources.
 *
 * The fix keeps the local read and changes only what is recorded: a permanent,
 * commit-pinned `raw.githubusercontent.com` address built from the submodule's
 * own remote and the commit actually checked out. A commit-pinned address names
 * exactly the bytes this service ingested; a branch address drifts as the
 * upstream repository moves and breaks the moment a file is renamed or removed.
 *
 * This module never fetches anything itself. It only maps a local path to the
 * address that names the same bytes in public — pure string and process work,
 * so it is testable without a database or a network call standing in for one.
 */
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { submodules as submodulesRoot } from './paths'

/**
 * A minimal, explicit promise wrapper around `execFile`, rather than
 * `util.promisify(execFile)`. Node's built-in `child_process.execFile` carries
 * a `util.promisify.custom` implementation that resolves with `{ stdout,
 * stderr }`, but nothing about that contract is visible at this call site — a
 * mock standing in for `execFile` in a test has no reason to know it must
 * reproduce that undocumented-at-the-call-site symbol too, and one that
 * doesn't makes `promisify()` silently resolve with an array of both streams
 * instead. Handling the callback here directly means this module's behaviour
 * depends only on the ordinary error-first callback every `execFile` mock
 * already provides.
 */
const runGitRevParseHead = (cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, 'rev-parse', 'HEAD'], (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout.toString())
    })
  })

/** Where one vendored submodule's artwork actually lives in public. */
export type SubmoduleRepository = {
  /** The GitHub account or organization that owns the repository. */
  readonly owner: string
  /** The repository name, exactly as it appears in the GitHub URL. */
  readonly repo: string
  /** The branch to address when the checked-out commit cannot be resolved. */
  readonly defaultBranch: string
}

/**
 * Every submodule this service reads artwork from, keyed by the directory name
 * under `submodules/` (see `.gitmodules`). Adding a fifth submodule-backed
 * collector means adding its entry here — nothing else in this module changes.
 */
export const SUBMODULE_REPOSITORIES: Readonly<Record<string, SubmoduleRepository>> = Object.freeze({
  trustwallet: Object.freeze({ owner: 'trustwallet', repo: 'assets', defaultBranch: 'master' }),
  'smoldapp-tokenassets': Object.freeze({ owner: 'SmolDapp', repo: 'tokenAssets', defaultBranch: 'main' }),
  'ethereum-lists-tokens': Object.freeze({ owner: 'ethereum-lists', repo: 'tokens', defaultBranch: 'master' }),
  'pulsechain-assets': Object.freeze({ owner: 'PLS369', repo: 'pulsechain-assets', defaultBranch: 'main' }),
})

/** Where a local path lands inside a known submodule. */
export type SubmoduleLocation = {
  /** The directory name under `submodules/`, and the key into `SUBMODULE_REPOSITORIES`. */
  readonly submoduleName: string
  /** The path of the file relative to the submodule's own root, forward-slash separated. */
  readonly pathWithinSubmodule: string
}

/**
 * Resolve which known submodule, if any, a local filesystem path falls under.
 *
 * Deliberately strict rather than clever: the path must be absolute (a
 * relative path would resolve against the process's current working
 * directory, which makes the answer depend on where the process happens to
 * run rather than on the path itself), its first path segment (relative to
 * `paths.submodules`) must name a submodule this module knows about, and
 * there must be a real file path after that segment — the submodule's own
 * root names no single file. Any path that fails one of these checks names no
 * known submodule and gets `null`, never a guess.
 *
 * A path outside `paths.submodules` entirely needs no separate check here: a
 * path.relative() from it always climbs out with a leading `..` segment
 * first, which is never a key in `SUBMODULE_REPOSITORIES`, so the "known
 * submodule name" check below already rejects it.
 *
 * @param localPath An absolute filesystem path, or `null`/`undefined`/empty.
 */
export const locateSubmodulePath = (localPath: string | null | undefined): SubmoduleLocation | null => {
  if (!localPath) return null
  if (!path.isAbsolute(localPath)) return null
  const relative = path.relative(submodulesRoot, localPath)
  const [submoduleName, ...rest] = relative.split(path.sep)
  if (!submoduleName || !(submoduleName in SUBMODULE_REPOSITORIES)) return null
  if (rest.length === 0) return null
  return { submoduleName, pathWithinSubmodule: rest.join('/') }
}

/**
 * One resolved commit (or default-branch fallback) per submodule, memoized for
 * the lifetime of the process. A collection run touches thousands of images
 * from the same four submodules, and the commit checked out does not change
 * mid-run, so every one of those images reuses the single resolution made for
 * the first — this is what "resolve once per run" means in practice: a cache
 * that make the first caller pay the cost and every later caller pay nothing.
 */
const commitCache = new Map<string, Promise<string>>()

/**
 * Shell out to `git rev-parse HEAD` inside one submodule's checkout. Not
 * memoized itself — `resolveSubmoduleRef` owns the cache — so this always
 * reflects a fresh process invocation when called directly.
 */
const readCheckedOutCommit = async (submoduleName: string): Promise<string> => {
  const cwd = path.join(submodulesRoot, submoduleName)
  const stdout = await runGitRevParseHead(cwd)
  const commit = stdout.trim()
  if (!commit) {
    throw new Error(`git rev-parse HEAD produced no commit for submodule ${submoduleName}`)
  }
  return commit
}

/**
 * Resolve the git ref to address a submodule's public repository at: the
 * commit actually checked out, or that repository's default branch when the
 * commit cannot be resolved (a shallow clone missing `.git`, a submodule not
 * yet initialized, `git` unavailable in the environment). The fallback is
 * still a real, permanent, fetchable address — never the local filesystem
 * path, which is the one address that must never leave this container.
 *
 * The result is cached per submodule name for the life of the process; call
 * `resetSubmoduleRefCache` to force re-resolution (tests only — a running
 * collection process never needs to, because the checked-out commit cannot
 * change during a single run).
 */
export const resolveSubmoduleRef = (submoduleName: string): Promise<string> => {
  const cached = commitCache.get(submoduleName)
  if (cached) return cached
  const repository = SUBMODULE_REPOSITORIES[submoduleName]
  const promise = readCheckedOutCommit(submoduleName).catch(() => repository.defaultBranch)
  commitCache.set(submoduleName, promise)
  return promise
}

/** Clears the per-process commit cache. Exists for tests; production code never needs it. */
export const resetSubmoduleRefCache = (): void => {
  commitCache.clear()
}

/**
 * A path segment, percent-encoded the way a URL path segment must be, without
 * touching the `/` separators between segments. Real submodule paths are
 * lowercase hex addresses and ordinary filenames and never need this, but a
 * filename with a space or another reserved character must still produce a
 * fetchable address rather than a broken one.
 */
const encodePathSegments = (relativePath: string): string => relativePath.split('/').map(encodeURIComponent).join('/')

/**
 * Build the public, fetchable address for a local path inside a known
 * submodule, or `null` when the path names no known submodule.
 *
 * The address is always `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`
 * — the commit checked out, or the repository's default branch as a fallback.
 * Never the local filesystem path: a caller cannot fetch that, which is the
 * defect this module exists to close. This function does no filesystem or
 * network I/O of its own beyond the one memoized `git rev-parse` per
 * submodule — it never reads the image bytes at `localPath`, so it is safe to
 * call for every image without affecting how those bytes are read.
 *
 * @param localPath An absolute filesystem path, ideally one already known to be
 *   inside `paths.submodules` (that is what every caller in `collect/` has).
 */
export const publicSourceAddress = async (localPath: string | null | undefined): Promise<string | null> => {
  const location = locateSubmodulePath(localPath)
  if (!location) return null
  const repository = SUBMODULE_REPOSITORIES[location.submoduleName]
  const ref = await resolveSubmoduleRef(location.submoduleName)
  const encodedPath = encodePathSegments(location.pathWithinSubmodule)
  return `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/${ref}/${encodedPath}`
}

/**
 * The same lookup as `publicSourceAddress`, but for a caller that already
 * knows its `localPath` was built under `paths.submodules` from one of the
 * four directory names in `SUBMODULE_REPOSITORIES` — every collector in
 * `collect/` that reads submodule artwork. For that caller a `null` result
 * names no ordinary "no artwork" case; it means the path it just built does
 * not map to a known submodule, which is a configuration defect (a renamed
 * submodule directory, a moved `paths.submodules`) rather than a missing
 * image. Failing loudly here is what stops that defect from being recorded
 * quietly as the one address this service must never publish: the local
 * filesystem path.
 *
 * @param localPath An absolute filesystem path a collector built under `paths.submodules`.
 * @throws When `localPath` does not map to a known submodule.
 */
export const requirePublicSourceAddress = async (localPath: string): Promise<string> => {
  const uri = await publicSourceAddress(localPath)
  if (!uri) {
    throw new Error(`no public address for submodule path ${localPath}`)
  }
  return uri
}
