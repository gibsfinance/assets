// Copies the built Storybook into the built site as dist/storybook, after `astro build`.
//
// Usage: node scripts/copy-storybook.ts   (run from packages/docs)
//
// Build the Storybook first: `yarn workspace ui run build:storybook`. The server then serves
// the copy at /storybook/ on the documentation host names (see server/docs-site.ts).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyStorybook } from './storybook-copy.ts'

const packageDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const destination = await copyStorybook({
  storybookDirectory: path.join(packageDirectory, '..', 'ui', 'storybook-static'),
  siteDirectory: path.join(packageDirectory, 'dist'),
})
console.log(`copied Storybook to ${destination}`)
