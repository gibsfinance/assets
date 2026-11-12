/**
 * @module openapi-menu-redirect
 * `starlight-openapi` draws two native `<select>` elements in the endpoint reference: one to pick
 * a media type or example, and one to pick a code sample. The design language forbids native
 * selects, so this site gives the plugin menu components in their place.
 *
 * The plugin imports its pickers by relative path, so no option replaces them. A small Vite
 * plugin answers those two imports with this site's components instead. The plugin's own files
 * stay untouched in `node_modules`.
 */
import { fileURLToPath } from 'node:url'

/** The plugin files that are replaced, and the component that takes each one's place. */
export const OPENAPI_MENU_REPLACEMENTS: Readonly<Record<string, string>> = {
  'ContentPicker.astro': fileURLToPath(new URL('../components/openapi/ContentMenu.astro', import.meta.url)),
  'OperationSnippetPicker.astro': fileURLToPath(new URL('../components/openapi/SnippetMenu.astro', import.meta.url)),
}

/** Matches the plugin's own folder in an import path, on any operating system. */
const PLUGIN_FOLDER = /[\\/]starlight-openapi[\\/]/

/**
 * The replacement for an import, or `undefined` when the import is not one of the two pickers.
 *
 * @param source The import specifier, for example `./ContentPicker.astro`.
 * @param importer The file that holds the import.
 * @param replacements Plugin file name to replacement component path.
 */
export const findOpenApiMenu = (
  source: string,
  importer: string | undefined,
  replacements: Readonly<Record<string, string>> = OPENAPI_MENU_REPLACEMENTS,
): string | undefined => {
  if (!importer || !PLUGIN_FOLDER.test(importer)) return undefined
  const fileName = source.slice(source.lastIndexOf('/') + 1)
  return Object.hasOwn(replacements, fileName) ? replacements[fileName] : undefined
}

/** The Vite plugin that applies {@link findOpenApiMenu} to every import. */
export const openApiMenuRedirect = () => ({
  name: 'gib-openapi-menu-redirect',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined): string | undefined {
    return findOpenApiMenu(source, importer)
  },
})
