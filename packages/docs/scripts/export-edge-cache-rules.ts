// Exports the gib.show edge cache rules from Cloudflare into the repository, or checks them for drift.
//
// Usage (from packages/docs). Set the two variables for this run only; never write them into a file:
//   CLOUDFLARE_ZONE_ID=<zone id> CLOUDFLARE_API_TOKEN=<token> node scripts/export-edge-cache-rules.ts
//   CLOUDFLARE_ZONE_ID=<zone id> CLOUDFLARE_API_TOKEN=<token> node scripts/export-edge-cache-rules.ts --check
//
// Export writes src/data/edge-cache-rules.json and rewrites the generated table in the caching page.
// Check reads the live rules and exits 1, naming each difference, when they differ from the committed file.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkEdgeCacheRules, exportEdgeCacheRules, readCloudflareSettings } from './edge-cache-rules-api.ts'

const packageDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = {
  rulesFile: path.join(packageDirectory, 'src', 'data', 'edge-cache-rules.json'),
  pageFile: path.join(packageDirectory, 'src', 'content', 'docs', 'api-reference', 'caching.md'),
}

const runCheck = async (settings: ReturnType<typeof readCloudflareSettings>): Promise<void> => {
  const differences = await checkEdgeCacheRules({ settings, fetchFunction: fetch, paths })
  if (differences.length === 0) {
    console.log('The live edge cache rules match the committed file.')
    return
  }
  console.error(`The live edge cache rules differ from the committed file (${differences.length}):`)
  for (const difference of differences) console.error(`  - ${difference}`)
  console.error('Run the export to update the committed file, then commit it.')
  process.exitCode = 1
}

const runExport = async (settings: ReturnType<typeof readCloudflareSettings>): Promise<void> => {
  const count = await exportEdgeCacheRules({ settings, fetchFunction: fetch, paths })
  console.log(`Exported ${count} edge cache rules and rewrote the table on the caching page.`)
}

try {
  const settings = readCloudflareSettings(process.env)
  if (process.argv.includes('--check')) {
    await runCheck(settings)
  } else {
    await runExport(settings)
  }
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
