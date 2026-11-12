// Writes the single-file markdown guides into the built site, after `astro build`.
//
// Usage: node scripts/generate-guides.ts   (run from packages/docs)
//
// The server answers /skills/*.md from <build output>/skills/ when these files exist. See
// guides.ts for what a page may contain.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeGuides } from './guides.ts'

const packageDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const written = await writeGuides({
  contentDirectory: path.join(packageDirectory, 'src', 'content', 'docs'),
  outputDirectory: path.join(packageDirectory, 'dist'),
  siteUrl: (process.env['DOCS_SITE_URL'] || 'https://docs.gib.show').replace(/\/+$/, ''),
})
console.log(written.length > 0 ? `wrote guides: ${written.join(', ')}` : 'no guide pages found; wrote nothing')
