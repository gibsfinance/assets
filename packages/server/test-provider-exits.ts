#!/usr/bin/env tsx

/**
 * Provider exit isolation test
 *
 * Runs each provider in a child process, one at a time, to find
 * which providers fail to exit on their own. Each provider gets
 * a timeout — if the process doesn't exit before then, it's
 * flagged as a hanger.
 */

import { fork, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

const TIMEOUT_MS = parseInt(process.env.TIMEOUT ?? '120000', 10)
const ONLY = process.env.ONLY?.split(',').map((s) => s.trim())

interface ProviderResult {
  provider: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  error?: string
}

function runProvider(provider: string): Promise<ProviderResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    let timedOut = false
    let child: ChildProcess | null = null

    child = fork(
      new URL('./test-provider-worker.ts', import.meta.url).pathname,
      [provider],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV ?? 'development',
          DISABLE_TERMINAL: '1',
        },
      },
    )

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(`  [${provider}] ${text}`)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(`  [${provider}:err] ${text}`)
    })

    const timer = setTimeout(() => {
      timedOut = true
      console.log(`\n  ⏰ ${provider} timed out after ${TIMEOUT_MS / 1000}s — killing`)
      child?.kill('SIGTERM')
      setTimeout(() => {
        if (child && !child.killed) {
          child.kill('SIGKILL')
        }
      }, 5000)
    }, TIMEOUT_MS)

    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({
        provider,
        exitCode: code,
        signal: signal,
        durationMs: Date.now() - start,
        timedOut,
        error: stderr.trim() || undefined,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        provider,
        exitCode: null,
        signal: null,
        durationMs: Date.now() - start,
        timedOut: false,
        error: err.message,
      })
    })
  })
}

async function main() {
  const { allCollectables } = await import('./src/collect/collectables')
  const all = allCollectables()

  const providers = ONLY ? all.filter((p) => ONLY.includes(p)) : all

  console.log(`\n🧪 Provider Exit Isolation Test`)
  console.log(`   Timeout: ${TIMEOUT_MS / 1000}s per provider`)
  console.log(`   Providers: ${providers.length} of ${all.length}`)
  if (ONLY) console.log(`   Filter: ${ONLY.join(', ')}`)
  console.log('─'.repeat(60))

  const results: ProviderResult[] = []

  for (const provider of providers) {
    console.log(`\n▶ ${provider}`)
    const result = await runProvider(provider)
    results.push(result)

    const duration = (result.durationMs / 1000).toFixed(1)
    if (result.timedOut) {
      console.log(`  🔴 HUNG — did not exit within ${TIMEOUT_MS / 1000}s`)
    } else if (result.exitCode === 0) {
      console.log(`  🟢 exited cleanly in ${duration}s`)
    } else {
      console.log(`  🟡 exited with code ${result.exitCode} (signal: ${result.signal}) in ${duration}s`)
    }
  }

  console.log('\n' + '═'.repeat(60))
  console.log('📊 RESULTS')
  console.log('═'.repeat(60))

  const clean = results.filter((r) => !r.timedOut && r.exitCode === 0)
  const hung = results.filter((r) => r.timedOut)
  const crashed = results.filter((r) => !r.timedOut && r.exitCode !== 0)

  if (clean.length > 0) {
    console.log(`\n🟢 Clean exit (${clean.length}):`)
    for (const r of clean) {
      console.log(`   ${r.provider.padEnd(25)} ${(r.durationMs / 1000).toFixed(1)}s`)
    }
  }

  if (hung.length > 0) {
    console.log(`\n🔴 Hung / did not exit (${hung.length}):`)
    for (const r of hung) {
      console.log(`   ${r.provider.padEnd(25)} killed after ${(r.durationMs / 1000).toFixed(1)}s`)
    }
  }

  if (crashed.length > 0) {
    console.log(`\n🟡 Crashed (${crashed.length}):`)
    for (const r of crashed) {
      console.log(`   ${r.provider.padEnd(25)} code=${r.exitCode} signal=${r.signal}`)
    }
  }

  console.log(`\n${clean.length}/${results.length} providers exit cleanly`)

  if (hung.length > 0) {
    console.log('\n⚠️  Hung providers need investigation — these prevent the process from exiting.')
    process.exit(1)
  }
}

main()
