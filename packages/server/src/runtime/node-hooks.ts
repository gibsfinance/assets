/**
 * Module hooks that let plain `node` run this package's TypeScript source.
 *
 * Node strips type annotations itself, but two things in the source are still out of its
 * reach, and `tsx` used to cover both:
 *
 *   1. Relative imports carry no file extension (`'../db'`, `'./logger'`). Node's
 *      resolver wants the exact file. {@link resolve} finds `.ts`, `.tsx` or `index.ts`.
 *   2. The terminal view is JSX (`log/App.tsx`), which type stripping does not accept.
 *      {@link load} compiles `.tsx` files with esbuild. Nothing else reaches esbuild, so a
 *      process that never loads a `.tsx` file never loads esbuild either.
 *
 * Running `node --import ./src/bin/register-hooks.ts <entry>` replaces `yarn run <script>`,
 * which kept three extra processes alive (yarn, the tsx launcher and the esbuild service).
 *
 * This file must not import any local module: it is loaded before the hooks it defines
 * are in place, so its own imports cannot use them.
 */
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Extensions tried, in order, for an import that names no extension. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'] as const

/** An import that already names a file type must be left to Node. */
const NAMED_EXTENSION = /\.(?:[cm]?[jt]sx?|json|node|wasm)$/

/** What the `resolve` hook needs from Node's default resolver. */
type NextResolve = (specifier: string, context?: unknown) => Promise<{ url: string }> | { url: string }

/** What the `load` hook needs from Node's default loader. */
type NextLoad = (url: string, context?: unknown) => Promise<unknown> | unknown

/** The part of esbuild's `transform` this file uses. */
export type TransformSource = (
  source: string,
  options: { loader: 'tsx'; jsx: 'automatic'; format: 'esm'; sourcefile: string; sourcemap: 'inline' },
) => Promise<{ code: string }>

/**
 * Whether an import names a local file without saying which kind.
 *
 * @param specifier The text inside the quotes of an `import` statement.
 * @returns True for `./x` and `../x` with no file extension.
 */
export function isExtensionlessRelativeImport(specifier: string): boolean {
  const isRelative =
    specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')
  return isRelative && !NAMED_EXTENSION.test(specifier)
}

/**
 * Every spelling an extensionless import could mean, most specific first.
 *
 * A file beats a directory of the same name, which is the order the TypeScript compiler
 * uses, so the answer matches what the type checker already accepted.
 *
 * @param specifier An extensionless relative import.
 * @returns Candidate specifiers, for example `['../db.ts', '../db.tsx', '../db/index.ts', '../db/index.tsx']`.
 *   A specifier that names a directory (`'.'`, `'..'`, or a trailing slash) gets only the `index` forms.
 */
export function candidateSpecifiers(specifier: string): string[] {
  const trimmed = specifier.replace(/\/+$/, '')
  const namesDirectory = trimmed !== specifier || trimmed === '.' || trimmed === '..'
  const asFiles = namesDirectory ? [] : SOURCE_EXTENSIONS.map((extension) => `${trimmed}${extension}`)
  const asDirectories = SOURCE_EXTENSIONS.map((extension) => `${trimmed}/index${extension}`)
  return [...asFiles, ...asDirectories]
}

/**
 * Whether a path is a regular file. A missing path is simply not a file.
 *
 * @param filePath Absolute path.
 * @returns True when the path exists and is a file.
 */
export function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Finds the source file an extensionless import refers to.
 *
 * @param specifier The import text.
 * @param parentUrl The `file:` URL of the module that holds the import.
 * @param fileExists Answers whether a path is a file. Defaults to the real file system.
 * @returns The first candidate specifier that exists, or null when none does.
 */
export function findSourceSpecifier(
  specifier: string,
  parentUrl: string,
  fileExists: (filePath: string) => boolean = isFile,
): string | null {
  if (!isExtensionlessRelativeImport(specifier)) return null
  const found = candidateSpecifiers(specifier).find((candidate) =>
    fileExists(fileURLToPath(new URL(candidate, parentUrl))),
  )
  return found ?? null
}

/**
 * Node `resolve` hook: completes extensionless relative imports of local source.
 *
 * Imports from `node_modules` are never touched, so a package keeps its own rules.
 *
 * @param specifier The import text.
 * @param context Node's resolution context; `parentURL` names the importing module.
 * @param nextResolve Node's own resolver.
 * @returns The resolution Node would give, after the extension is added where needed.
 */
export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: NextResolve,
): Promise<{ url: string }> {
  const parentUrl = context.parentURL ?? ''
  const isLocalParent = parentUrl.startsWith('file:') && !parentUrl.includes('/node_modules/')
  if (!isLocalParent) return nextResolve(specifier, context)
  const completed = findSourceSpecifier(specifier, parentUrl)
  return nextResolve(completed ?? specifier, context)
}

/**
 * Loads esbuild's `transform` on first use.
 *
 * @returns esbuild's `transform` function.
 */
export async function loadEsbuildTransform(): Promise<TransformSource> {
  const esbuild = await import('esbuild')
  return esbuild.transform as unknown as TransformSource
}

/**
 * Node `load` hook: compiles `.tsx` files; hands every other file back to Node.
 *
 * @param url The module URL being loaded.
 * @param context Node's load context.
 * @param nextLoad Node's own loader, which strips types from `.ts` files.
 * @param transform Compiles JSX. Defaults to esbuild, loaded only when a `.tsx` file appears.
 * @returns The loaded module.
 */
export async function load(
  url: string,
  context: unknown,
  nextLoad: NextLoad,
  transform?: TransformSource,
): Promise<unknown> {
  if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context)
  const compile = transform ?? (await loadEsbuildTransform())
  const filePath = fileURLToPath(url)
  const source = await readFile(filePath, 'utf8')
  const { code } = await compile(source, {
    loader: 'tsx',
    jsx: 'automatic',
    format: 'esm',
    sourcefile: filePath,
    sourcemap: 'inline',
  })
  return { format: 'module', source: code, shortCircuit: true }
}
