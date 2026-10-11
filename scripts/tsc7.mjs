#!/usr/bin/env node
/**
 * Runs the TypeScript 7 native compiler with the arguments it was given.
 *
 * Two TypeScript versions sit side by side. `typescript` stays on 6.x, because
 * typescript-eslint loads the classic JavaScript compiler API and TypeScript 7
 * ships none. `@typescript/native` is TypeScript 7, and every typecheck and
 * build runs it through this script.
 *
 * Both packages name their binary `tsc`, so a bare `tsc` is ambiguous. This
 * script resolves TypeScript 7 by package name instead. TypeScript 7 does not
 * export `bin/tsc`, so the path is built from its `package.json`.
 *
 * Retire this when typescript-eslint supports TypeScript 7: move `typescript`
 * to 7, drop `@typescript/native`, and change the callers back to `tsc`.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const packageDirectory = path.dirname(require.resolve('@typescript/native/package.json'))
const compiler = path.join(packageDirectory, 'bin', 'tsc')

const result = spawnSync(process.execPath, [compiler, ...process.argv.slice(2)], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
