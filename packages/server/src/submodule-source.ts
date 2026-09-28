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
 * The fix keeps the local read and changes only what is recorded: the file's
 * `raw.githubusercontent.com` address on the repository's default branch - the
 * same form every other source and token list uses, keyed by chain and token
 * address, and stable for as long as the file itself is.
 *
 * It was briefly pinned to the checked-out commit instead, and that was wrong.
 * An image's identity hashes its bytes together with its address, so a commit
 * in the address gave every file a new identity - and a new stored copy - on
 * every upstream commit, changed or not. Trust Wallet commits about daily; its
 * 14,603 files had reached five copies each within a week. The bytes already
 * version the image: a file that really changes upstream gets a new identity
 * from its new content, with no help from the address.
 *
 * This module never fetches anything itself and runs no processes. It only maps a
 * local path to the public address of the same file - pure string work.
 */
import * as path from 'node:path'
import { submodules as submodulesRoot } from './paths'

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

/**
 * The host every public address this module builds is served from. Exported so
 * `image/attribution.ts` can recognize a live-fetched (non-submodule) GitHub
 * address, such as web3icons's, without retyping the hostname.
 */
export const PUBLIC_CONTENT_HOST = 'raw.githubusercontent.com'

/**
 * Which known submodule a public address points into, or null.
 *
 * The inverse of `publicSourceAddress`, and the reason it matters: once these
 * collectors record a public address instead of a local path, the address is the
 * only thing some serving paths have to go on. The content-addressed image route
 * holds no provider at all - one stored image can belong to several - so its
 * attribution comes from the address alone. A local path used to name its source in
 * its first segment; a public address names it in its owner and repository, and
 * this reads it back out of there.
 *
 * Owner and repository are compared without regard to case, because the forge
 * treats them that way: `smoldapp/tokenassets` and `SmolDapp/tokenAssets` are the
 * same repository. An address on any other host, or naming a repository this module
 * does not know, is not one of ours and answers null rather than a guess.
 */
export const submoduleNameForPublicAddress = (uri: string | null | undefined): string | null => {
  if (!uri) return null
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  if (parsed.hostname !== PUBLIC_CONTENT_HOST) return null
  const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
  if (!owner || !repo) return null
  const match = Object.entries(SUBMODULE_REPOSITORIES).find(
    ([, known]) => known.owner.toLowerCase() === owner.toLowerCase() && known.repo.toLowerCase() === repo.toLowerCase(),
  )
  return match ? match[0] : null
}

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
 * The address is always `https://raw.githubusercontent.com/<owner>/<repo>/<default branch>/<path>`.
 * Never the local filesystem path: a caller cannot fetch that, which is the
 * defect this module exists to close. No I/O at all - it never reads the image
 * bytes at `localPath` - so it is safe to call for every image.
 *
 * @param localPath An absolute filesystem path, ideally one already known to be
 *   inside `paths.submodules` (that is what every caller in `collect/` has).
 */
export const publicSourceAddress = (localPath: string | null | undefined): string | null => {
  const location = locateSubmodulePath(localPath)
  if (!location) return null
  const repository = SUBMODULE_REPOSITORIES[location.submoduleName]
  const encodedPath = encodePathSegments(location.pathWithinSubmodule)
  return `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/${repository.defaultBranch}/${encodedPath}`
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
export const requirePublicSourceAddress = (localPath: string): string => {
  const uri = publicSourceAddress(localPath)
  if (!uri) {
    throw new Error(`no public address for submodule path ${localPath}`)
  }
  return uri
}
