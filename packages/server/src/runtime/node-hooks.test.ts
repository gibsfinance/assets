import { execFile } from 'node:child_process'
import * as fileSystem from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  candidateSpecifiers,
  findSourceSpecifier,
  isExtensionlessRelativeImport,
  isFile,
  load,
  loadEsbuildTransform,
  resolve,
} from './node-hooks'

const execute = promisify(execFile)

describe('isExtensionlessRelativeImport', () => {
  it.each(['./logger', '../db', '../../config', '.', '..', './log/types', './thing.service'])(
    'is true for %j, which names a local file without its extension',
    (specifier) => {
      expect(isExtensionlessRelativeImport(specifier)).toBe(true)
    },
  )

  it.each(['./a.ts', './a.tsx', './a.js', './a.mjs', './a.cjs', './data.json', './x.node', './x.wasm'])(
    'is false for %j, which already names its file',
    (specifier) => {
      expect(isExtensionlessRelativeImport(specifier)).toBe(false)
    },
  )

  it.each(['viem', '@gibs/utils/fetch', 'node:fs', '/absolute/path', 'file:///x/y', '#internal'])(
    'is false for %j, which is not a relative import',
    (specifier) => {
      expect(isExtensionlessRelativeImport(specifier)).toBe(false)
    },
  )
})

describe('candidateSpecifiers', () => {
  it('tries the file forms before the directory forms', () => {
    expect(candidateSpecifiers('../db')).toEqual(['../db.ts', '../db.tsx', '../db/index.ts', '../db/index.tsx'])
  })

  it('offers only the directory forms for a specifier that names a directory', () => {
    expect(candidateSpecifiers('.')).toEqual(['./index.ts', './index.tsx'])
    expect(candidateSpecifiers('..')).toEqual(['../index.ts', '../index.tsx'])
    expect(candidateSpecifiers('./log/')).toEqual(['./log/index.ts', './log/index.tsx'])
  })
})

describe('findSourceSpecifier', () => {
  const parentUrl = 'file:///app/src/bin/server.ts'

  it('returns the first candidate the file system has', () => {
    const present = new Set(['/app/src/db/index.ts', '/app/src/db/index.tsx'])

    expect(findSourceSpecifier('../db', parentUrl, (filePath) => present.has(filePath))).toBe('../db/index.ts')
  })

  it('prefers a file over a directory of the same name', () => {
    const present = new Set(['/app/src/log.tsx', '/app/src/log/index.ts'])

    expect(findSourceSpecifier('../log', parentUrl, (filePath) => present.has(filePath))).toBe('../log.tsx')
  })

  it('returns null when nothing matches, and for imports that need no help', () => {
    expect(findSourceSpecifier('../missing', parentUrl, () => false)).toBeNull()
    expect(findSourceSpecifier('viem', parentUrl, () => true)).toBeNull()
    expect(findSourceSpecifier('./done.ts', parentUrl, () => true)).toBeNull()
  })

  it('checks the real file system by default', () => {
    const here = pathToFileURL(fileURLToPath(import.meta.url)).href

    expect(findSourceSpecifier('./node-hooks', here)).toBe('./node-hooks.ts')
    expect(findSourceSpecifier('./no-such-module', here)).toBeNull()
  })
})

describe('isFile', () => {
  it('is true for a file and false for a directory or a missing path', () => {
    expect(isFile(fileURLToPath(import.meta.url))).toBe(true)
    expect(isFile(path.dirname(fileURLToPath(import.meta.url)))).toBe(false)
    expect(isFile('/no/such/path/anywhere')).toBe(false)
  })
})

describe('resolve', () => {
  const nextResolve = vi.fn(async (specifier: string) => ({ url: `resolved:${specifier}` }))
  const here = pathToFileURL(fileURLToPath(import.meta.url)).href

  it('completes an extensionless import from local source', async () => {
    nextResolve.mockClear()

    const result = await resolve('./node-hooks', { parentURL: here }, nextResolve)

    expect(result).toEqual({ url: 'resolved:./node-hooks.ts' })
  })

  it('hands an import it cannot complete to Node unchanged, so Node reports the real error', async () => {
    nextResolve.mockClear()

    const result = await resolve('./no-such-module', { parentURL: here }, nextResolve)

    expect(result).toEqual({ url: 'resolved:./no-such-module' })
  })

  it('does not touch imports made from inside node_modules, from non-files, or from nowhere', async () => {
    const parents: (string | undefined)[] = [
      'file:///app/node_modules/pkg/index.js',
      'data:text/javascript,export{}',
      undefined,
    ]
    for (const parentURL of parents) {
      nextResolve.mockClear()
      await resolve('./node-hooks', { parentURL }, nextResolve)
      expect(nextResolve).toHaveBeenCalledWith('./node-hooks', { parentURL })
    }
  })
})

describe('load', () => {
  const nextLoad = vi.fn(async () => ({ format: 'module', source: 'from-node' }))

  it('hands everything except .tsx files back to Node', async () => {
    for (const url of ['file:///app/a.ts', 'file:///app/a.js', 'node:fs', 'data:text/javascript,export{}']) {
      nextLoad.mockClear()
      expect(await load(url, { format: 'module' }, nextLoad)).toEqual({ format: 'module', source: 'from-node' })
      expect(nextLoad).toHaveBeenCalledWith(url, { format: 'module' })
    }
  })

  it('compiles a .tsx file and returns it as an ES module that Node must not load again', async () => {
    const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'node-hooks-load-'))
    const file = path.join(directory, 'view.tsx')
    await fileSystem.writeFile(file, 'export const view = <b>hi</b>')
    const transform = vi.fn(async () => ({ code: 'compiled output' }))

    const result = await load(pathToFileURL(file).href, {}, nextLoad, transform)

    expect(result).toEqual({ format: 'module', source: 'compiled output', shortCircuit: true })
    expect(transform).toHaveBeenCalledWith('export const view = <b>hi</b>', {
      loader: 'tsx',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: file,
      sourcemap: 'inline',
    })
    await fileSystem.rm(directory, { recursive: true, force: true })
  })

  it('uses esbuild when no compiler is passed', async () => {
    const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'node-hooks-load-'))
    const file = path.join(directory, 'view.tsx')
    await fileSystem.writeFile(file, 'export const label: string = "x"\nexport const view = <b>{label}</b>')

    const result = (await load(pathToFileURL(file).href, {}, nextLoad)) as { source: string; format: string }

    expect(result.format).toBe('module')
    expect(result.source).toContain('react/jsx-runtime')
    expect(result.source).not.toContain(': string')
    await fileSystem.rm(directory, { recursive: true, force: true })
  })
})

describe('loadEsbuildTransform', () => {
  it('returns esbuild transform', async () => {
    const transform = await loadEsbuildTransform()

    const { code } = await transform('const answer: number = 42', {
      loader: 'tsx',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: 'answer.tsx',
      sourcemap: 'inline',
    })

    expect(code).toContain('const answer = 42')
  })
})

describe('running plain node with the hooks', () => {
  it('runs source that has extensionless imports, a directory import and a .tsx file', async () => {
    const directory = await fileSystem.mkdtemp(path.join(os.tmpdir(), 'node-hooks-run-'))
    await fileSystem.mkdir(path.join(directory, 'lib'))
    await fileSystem.writeFile(path.join(directory, 'lib', 'index.ts'), 'export const fromDirectory: string = "dir"\n')
    await fileSystem.writeFile(path.join(directory, 'plain.ts'), 'export const fromFile: number = 7\n')
    await fileSystem.writeFile(
      path.join(directory, 'view.tsx'),
      'export const element = <b>one</b>\nexport const kind: string = typeof element\n',
    )
    await fileSystem.writeFile(
      path.join(directory, 'main.ts'),
      [
        "import { fromDirectory } from './lib'",
        "import { fromFile } from './plain'",
        "import { kind } from './view'",
        'console.log(JSON.stringify({ fromDirectory, fromFile, kind }))',
        '',
      ].join('\n'),
    )
    // The compiled view imports react/jsx-runtime, so the fixture needs a path to the installed packages.
    const installed = fileURLToPath(new URL('../../../../node_modules', import.meta.url))
    await fileSystem.symlink(installed, path.join(directory, 'node_modules'))
    const preload = fileURLToPath(new URL('../bin/register-hooks.ts', import.meta.url))

    const { stdout } = await execute(process.execPath, ['--import', preload, path.join(directory, 'main.ts')], {
      cwd: path.dirname(preload),
    })

    expect(JSON.parse(stdout)).toEqual({ fromDirectory: 'dir', fromFile: 7, kind: 'object' })
    await fileSystem.rm(directory, { recursive: true, force: true })
  }, 30_000)
})
