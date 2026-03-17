#!/usr/bin/env tsx

/**
 * Worker process for provider exit isolation test.
 * Spawned by test-provider-exits.ts for a single provider.
 *
 * Sets up the DB, runs the provider's collector, cleans up, and exits.
 * If the process doesn't exit, the parent will detect the hang.
 */

// Must be set before any imports to prevent Ink terminal initialization
process.env.DISABLE_TERMINAL = '1'

import * as db from './src/db'
import { cleanup } from './src/cleanup'
import { collectables, type Collectable } from './src/collect/collectables'

const provider = process.argv[2] as Collectable

if (!provider) {
  console.error('Usage: test-provider-worker.ts <provider>')
  process.exit(2)
}

async function run() {
  const dbInstance = db.getDB()
  await dbInstance.migrate.latest()
  await db.purgeExpiredCache().catch(() => {})

  const c = collectables()
  const collector = c[provider]

  if (!collector) {
    console.log(`No collector found for "${provider}"`)
    process.exit(2)
  }

  const controller = new AbortController()
  const start = Date.now()

  try {
    console.log(`Starting ${provider}...`)
    await collector(controller.signal)
    const duration = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`${provider} collector returned after ${duration}s`)
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(1)
    console.error(`${provider} threw after ${duration}s:`, err)
    throw err
  } finally {
    console.log(`Cleaning up ${provider}...`)
    await cleanup()
    console.log(`Cleanup done for ${provider}`)
  }
}

run()
  .then(() => {
    console.log(`Worker for ${provider} finished — exiting`)
    process.exit(0)
  })
  .catch((err) => {
    console.error(`Worker for ${provider} failed:`, err)
    process.exit(1)
  })
