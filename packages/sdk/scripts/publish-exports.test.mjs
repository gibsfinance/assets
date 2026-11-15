import { describe, it, expect } from 'vitest'
import { builtTarget, isRunDirectly, rewriteSourceExports } from './publish-exports.mjs'

describe('isRunDirectly', () => {
  it('is false when the script is imported rather than run, as it is under the test runner', () => {
    expect(isRunDirectly()).toBe(false)
  })
})

describe('builtTarget', () => {
  it('moves a source declaration to its built declaration file', () => {
    expect(builtTarget('types', './src/sprite-layout.ts')).toBe('./dist/sprite-layout.d.ts')
  })

  it('moves a source module to its built JavaScript file under any other condition', () => {
    expect(builtTarget('import', './src/sprite-layout.ts')).toBe('./dist/sprite-layout.js')
  })

  it('leaves a target outside the source directory unchanged', () => {
    expect(builtTarget('import', './dist/index.js')).toBe('./dist/index.js')
  })
})

describe('rewriteSourceExports', () => {
  const manifest = {
    name: '@gibs/sdk',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './sprite-layout': {
        types: './src/sprite-layout.ts',
        import: './src/sprite-layout.ts',
      },
    },
  }

  it('points every source subpath at its built file and keeps the rest of the manifest', () => {
    const rewritten = rewriteSourceExports(manifest)
    expect(rewritten.exports['./sprite-layout']).toEqual({
      types: './dist/sprite-layout.d.ts',
      import: './dist/sprite-layout.js',
    })
    expect(rewritten.exports['.']).toEqual(manifest.exports['.'])
    expect(rewritten.name).toBe('@gibs/sdk')
  })

  it('handles a subpath whose target is a single string', () => {
    const rewritten = rewriteSourceExports({
      exports: { './x': './src/x.ts' },
    })
    expect(rewritten.exports['./x']).toBe('./dist/x.js')
  })

  it('does not change the manifest it was given', () => {
    rewriteSourceExports(manifest)
    expect(manifest.exports['./sprite-layout'].import).toBe('./src/sprite-layout.ts')
  })
})
