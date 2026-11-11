// Fetches the vendored artwork repositories into one directory, shallow and sparse.
//
// Usage: node scripts/refresh-submodules.mjs <directory>
//
// The image build runs this to leave a working copy in the worker image, so a fresh
// container can collect before its first refresh. It uses the same module the collector
// uses at run time, so the list of repositories and directories exists in one place.
// Node strips the types from the module itself; no install is needed.
//
// Exits non-zero when any repository ends up with nothing on disk, which fails the build
// rather than shipping an image whose collectors find empty directories.
import * as path from 'node:path'
import { createSystemDependencies, everyRepositoryPresent, refreshSubmodules } from '../packages/server/src/submodule-refresh.ts'

const directory = process.argv[2]
if (!directory) {
  console.error('usage: node scripts/refresh-submodules.mjs <directory>')
  process.exit(2)
}

const outcomes = await refreshSubmodules(createSystemDependencies(console.log), path.resolve(directory))
if (!everyRepositoryPresent(outcomes)) {
  console.error('some repositories could not be fetched: %o', outcomes)
  process.exit(1)
}
