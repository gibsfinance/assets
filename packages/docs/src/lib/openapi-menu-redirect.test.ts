import { describe, expect, it } from 'vitest'
import { OPENAPI_MENU_REPLACEMENTS, findOpenApiMenu, openApiMenuRedirect } from './openapi-menu-redirect.ts'
import { existsSync } from 'node:fs'

const replacements = { 'ContentPicker.astro': '/site/ContentMenu.astro' }
const insidePlugin = '/repo/node_modules/starlight-openapi/components/MediaEntries.astro'

describe('findOpenApiMenu', () => {
  it('answers an import of a picker made from inside the plugin', () => {
    expect(findOpenApiMenu('./ContentPicker.astro', insidePlugin, replacements)).toBe('/site/ContentMenu.astro')
    expect(findOpenApiMenu('../ContentPicker.astro', insidePlugin, replacements)).toBe('/site/ContentMenu.astro')
  })

  it('works with Windows-style paths', () => {
    const importer = 'C:\\repo\\node_modules\\starlight-openapi\\components\\MediaEntries.astro'
    expect(findOpenApiMenu('./ContentPicker.astro', importer, replacements)).toBe('/site/ContentMenu.astro')
  })

  it('leaves imports from anywhere else alone', () => {
    expect(findOpenApiMenu('./ContentPicker.astro', '/repo/src/page.astro', replacements)).toBeUndefined()
    expect(findOpenApiMenu('./ContentPicker.astro', undefined, replacements)).toBeUndefined()
  })

  it('leaves other plugin imports alone, including names on the object prototype', () => {
    expect(findOpenApiMenu('./Schema.astro', insidePlugin, replacements)).toBeUndefined()
    expect(findOpenApiMenu('./constructor', insidePlugin, replacements)).toBeUndefined()
    expect(findOpenApiMenu('', insidePlugin, replacements)).toBeUndefined()
  })

  it('replaces both pickers by default, with components that exist', () => {
    expect(Object.keys(OPENAPI_MENU_REPLACEMENTS).sort()).toEqual([
      'ContentPicker.astro',
      'OperationSnippetPicker.astro',
    ])
    for (const path of Object.values(OPENAPI_MENU_REPLACEMENTS)) expect(existsSync(path)).toBe(true)
    expect(findOpenApiMenu('./OperationSnippetPicker.astro', insidePlugin)).toBe(
      OPENAPI_MENU_REPLACEMENTS['OperationSnippetPicker.astro'],
    )
  })
})

describe('openApiMenuRedirect', () => {
  it('is a Vite plugin that runs before the others and resolves through findOpenApiMenu', () => {
    const plugin = openApiMenuRedirect()
    expect(plugin.enforce).toBe('pre')
    expect(plugin.resolveId('./ContentPicker.astro', insidePlugin)).toBe(
      OPENAPI_MENU_REPLACEMENTS['ContentPicker.astro'],
    )
    expect(plugin.resolveId('./Other.astro', insidePlugin)).toBeUndefined()
  })
})
