/**
 * @module storybook-copy
 * Puts the built Storybook inside the built documentation site, so it is served at `/storybook/`.
 */
import { access, cp, rm } from 'node:fs/promises'
import path from 'node:path'

/** The directory, inside the built site, where Storybook is served from. */
export const STORYBOOK_DIRECTORY_NAME = 'storybook'

/**
 * Copy a built Storybook to `<siteDirectory>/storybook`, replacing any earlier copy.
 *
 * @param options.storybookDirectory The static output of `storybook build`.
 * @param options.siteDirectory The built documentation site (`packages/docs/dist`).
 * @returns The directory the files were copied to.
 * @throws When the Storybook has not been built or has no `index.html`, so a deploy never
 *   ships a site with a dead link.
 */
export const copyStorybook = async (options: {
  storybookDirectory: string
  siteDirectory: string
}): Promise<string> => {
  const entryPage = path.join(options.storybookDirectory, 'index.html')
  await access(entryPage).catch(() => {
    throw new Error(
      `No built Storybook found: ${entryPage} does not exist. Run "yarn workspace ui run build:storybook".`,
    )
  })
  const destination = path.join(options.siteDirectory, STORYBOOK_DIRECTORY_NAME)
  await rm(destination, { recursive: true, force: true })
  await cp(options.storybookDirectory, destination, { recursive: true })
  return destination
}
