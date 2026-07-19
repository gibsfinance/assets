/**
 * Regenerates src/lib/networks.json — the chain-id -> display-name map that
 * getNetworkName() falls back to before giving up and rendering "Chain <id>".
 *
 * The source is the ethereum-lists registry (chainid.network/chains.json), the same
 * feed the server's chainlist collector reads. The two drift apart on their own
 * schedules: the collector adds a network the moment the registry lists an icon for
 * it, while this map only moves when someone runs this script. When it lags, the
 * studio's network drawer shows real logos above "Chain 97477" labels.
 *
 * The transforms live in src/lib/utils/network-name-source.ts so they stay testable
 * without a network call. This file is only the fetch and the write.
 *
 * Run: yarn workspace ui run gen:networks
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { toNameMap, mergeNameMaps } from '../src/lib/utils/network-name-source'

const chainsUrl = 'https://chainid.network/chains.json'
const outputPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'networks.json')

const run = async () => {
  const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8')) as Record<string, string>

  const response = await fetch(chainsUrl)
  if (!response.ok) throw new Error(`${chainsUrl} responded ${response.status}`)
  const upstream = toNameMap(await response.json())

  const merged = mergeNameMaps(existing, upstream)

  const added = Object.keys(merged).filter((id) => !existing[id])
  const renamed = Object.keys(merged).filter((id) => existing[id] && existing[id] !== merged[id])
  const keptLocal = Object.keys(existing).filter((id) => !upstream[id])

  fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`)

  console.log(`networks.json: ${Object.keys(existing).length} -> ${Object.keys(merged).length} entries`)
  console.log(`  added:   ${added.length}`)
  console.log(`  renamed: ${renamed.length}`)
  console.log(`  kept (dropped upstream, preserved locally): ${keptLocal.length}`)
}

run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
