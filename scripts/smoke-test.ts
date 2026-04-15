#!/usr/bin/env tsx
/**
 * Smoke tests for staging.gib.show (or any BASE_URL).
 * Usage:
 *   tsx scripts/smoke-test.ts
 *   BASE_URL=https://staging.gib.show tsx scripts/smoke-test.ts
 */

const BASE_URL = process.env.BASE_URL ?? 'https://staging.gib.show'

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const CHAIN_ETH = 1

type TestCase = {
  name: string
  path: string
  expectStatus?: number
  expectContentType?: string
  /** Check speed only on re-fetch (second request). First fetch is unchecked. */
  refetch?: boolean
  warnSlowMs?: number
}

const TESTS: TestCase[] = [
  { name: 'health check', path: '/health', expectStatus: 200 },
  { name: 'networks list', path: '/networks', expectStatus: 200 },
  { name: 'token stats', path: '/stats', expectStatus: 200 },
  { name: 'all lists', path: '/list', expectStatus: 200 },
  { name: `tokens on chain ${CHAIN_ETH}`, path: `/list/tokens/${CHAIN_ETH}`, expectStatus: 200, refetch: true, warnSlowMs: 3000 },
  { name: 'image (default)', path: `/image/${CHAIN_ETH}/${USDT}`, expectStatus: 200 },
  { name: 'image (as=webp)', path: `/image/${CHAIN_ETH}/${USDT}?as=webp`, expectStatus: 200, expectContentType: 'image/webp' },
  { name: 'image (as=png)', path: `/image/${CHAIN_ETH}/${USDT}?as=png`, expectStatus: 200, expectContentType: 'image/png' },
  { name: 'image (only=vector)', path: `/image/${CHAIN_ETH}/${USDT}?only=vector`, expectStatus: 200 },
  { name: 'chain image', path: `/image/${CHAIN_ETH}`, expectStatus: 200 },
]

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

type Result = { name: string; ok: boolean; status: number; ms: number; error?: string; warn?: string }

async function fetchOnce(url: string): Promise<{ res: Response; ms: number } | { error: string; ms: number }> {
  const start = Date.now()
  try {
    const res = await fetch(url)
    return { res, ms: Date.now() - start }
  } catch (err) {
    return { error: String(err), ms: Date.now() - start }
  }
}

async function runTest(test: TestCase): Promise<Result> {
  const url = `${BASE_URL}${test.path}`

  if (test.refetch) {
    // First fetch: cold, unchecked for speed
    const cold = await fetchOnce(url)
    if ('error' in cold) {
      return { name: test.name, ok: false, status: 0, ms: cold.ms, error: cold.error }
    }
    // Second fetch: warm, speed-checked
    const warm = await fetchOnce(url)
    if ('error' in warm) {
      return { name: test.name, ok: false, status: 0, ms: warm.ms, error: warm.error }
    }
    const { res, ms } = warm
    const status = res.status
    const failures: string[] = []
    if (test.expectStatus !== undefined && status !== test.expectStatus) {
      failures.push(`status ${status} (expected ${test.expectStatus})`)
    }
    const warn = test.warnSlowMs !== undefined && ms > test.warnSlowMs
      ? `re-fetch slow ${ms}ms (threshold ${test.warnSlowMs}ms)`
      : undefined
    if (failures.length > 0) {
      return { name: test.name, ok: false, status, ms, error: failures.join(', '), warn }
    }
    return { name: `${test.name} (re-fetch)`, ok: true, status, ms, warn }
  }

  const attempt = await fetchOnce(url)
  if ('error' in attempt) {
    return { name: test.name, ok: false, status: 0, ms: attempt.ms, error: attempt.error }
  }

  const { res, ms } = attempt
  const status = res.status
  const contentType = res.headers.get('content-type') ?? ''
  const failures: string[] = []

  if (test.expectStatus !== undefined && status !== test.expectStatus) {
    failures.push(`status ${status} (expected ${test.expectStatus})`)
  }
  if (test.expectContentType && !contentType.startsWith(test.expectContentType)) {
    failures.push(`content-type "${contentType}" (expected ${test.expectContentType})`)
  }

  if (failures.length > 0) {
    return { name: test.name, ok: false, status, ms, error: failures.join(', ') }
  }

  return { name: test.name, ok: true, status, ms }
}

async function main() {
  console.log(`\n${DIM}Smoke testing ${BASE_URL}${RESET}\n`)

  const results = await Promise.all(TESTS.map(runTest))

  let passed = 0
  let failed = 0

  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`
    const time = `${DIM}${r.ms}ms${RESET}`
    const warn = r.warn ? ` ${YELLOW}⚠ ${r.warn}${RESET}` : ''
    const err = r.error ? `  ${RED}→ ${r.error}${RESET}` : ''

    console.log(`  ${icon} ${r.name} ${time}${warn}${err}`)
    r.ok ? passed++ : failed++
  }

  console.log(`\n  ${passed}/${results.length} passed`)

  if (failed > 0) {
    console.log(`  ${RED}${failed} failed${RESET}\n`)
    process.exit(1)
  }

  console.log()
}

main()
