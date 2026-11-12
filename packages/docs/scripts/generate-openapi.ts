// Writes the server's OpenAPI definition to generated/openapi.json, where the Starlight
// plugin reads it. The definition is imported from the server's own source, so the endpoint
// reference cannot drift from the code. Node strips the types; no install step is needed beyond
// the workspace itself.
//
// Usage: node scripts/generate-openapi.ts   (run from packages/docs)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openapi } from '../../server/src/server/openapi.ts'
import { writeJson } from './write-json.ts'

const packageDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(packageDirectory, 'generated', 'openapi.json')

await writeJson(outputPath, openapi)
console.log('wrote %s', outputPath)
