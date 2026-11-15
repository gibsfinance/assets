#!/usr/bin/env node
/**
 * Points the package's source subpaths at their built files before the package is published.
 *
 * In the repository, `./sprite-layout` resolves to its TypeScript source, so the server can run the
 * module without a build. A published package must not point at source that Node refuses to load from
 * `node_modules`, so this runs as `prepublishOnly` and rewrites each source target to its built file.
 * The committed `package.json` keeps the source targets; only the published copy changes.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE_PREFIX = './src/'
const BUILT_PREFIX = './dist/'

/**
 * The built file for one source target. The `types` condition names the declaration file, and every other
 * condition names the emitted JavaScript.
 *
 * @param condition The condition the target sits under, such as `types` or `import`.
 * @param target A target path. Anything outside `./src/` is returned unchanged.
 * @returns The built path.
 */
export function builtTarget(condition, target) {
  if (!target.startsWith(SOURCE_PREFIX)) return target
  const stem = target.slice(SOURCE_PREFIX.length).replace(/\.ts$/, '')
  return `${BUILT_PREFIX}${stem}${condition === 'types' ? '.d.ts' : '.js'}`
}

/**
 * Rewrites every subpath of an exports map. A subpath is either one target or a map of conditions.
 *
 * @param manifest The parsed `package.json`.
 * @returns A new manifest with source targets moved to their built files.
 */
export function rewriteSourceExports(manifest) {
  const exportsMap = Object.fromEntries(
    Object.entries(manifest.exports).map(([subpath, target]) => [subpath, rewriteSubpath(target)]),
  )
  return { ...manifest, exports: exportsMap }
}

/**
 * Rewrites one subpath's target or conditions.
 *
 * @param target A string target, or an object of conditions.
 * @returns The same shape with its source targets rewritten.
 */
function rewriteSubpath(target) {
  if (typeof target === 'string') return builtTarget('import', target)
  return Object.fromEntries(
    Object.entries(target).map(([condition, value]) => [condition, builtTarget(condition, value)]),
  )
}

/**
 * Whether this file is the program being run, rather than a module something imported. The two paths are
 * compared as real paths, because a relative path or a symlinked directory names the same file differently.
 *
 * @returns True when the script was started directly.
 */
export function isRunDirectly() {
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
}

if (isRunDirectly()) {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
  writeFileSync(packagePath, `${JSON.stringify(rewriteSourceExports(manifest), null, 2)}\n`)
}
