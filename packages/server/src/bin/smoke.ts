#!/usr/bin/env tsx
/**
 * HTTP smoke tester for a running server (local, staging, or production).
 *
 * Usage:
 *   yarn smoke --url https://staging.gib.show
 *   yarn smoke --url http://localhost:3456 --chains 1,369,8453
 *   yarn smoke --url https://staging.gib.show --chains 1 --timeout 30
 *
 * Flags:
 *   --url <url>       Base URL of the server (required)
 *   --chains <list>   Comma-separated chain IDs to test (default: all from /stats)
 *   --top <n>         Test only the top N chains by token count (default: 10)
 *   --timeout <secs>  Per-request timeout in seconds (default: 30)
 *   --limit <n>       ?limit= param for /list/tokens (default: server default)
 */

type Args = {
  url: string
  chains?: string[]
  top: number
  timeoutMs: number
  limit?: number
}

const parseArgs = (argv: string[]): Args => {
  const args: Partial<Args> = { top: 10, timeoutMs: 30_000 }
  for (let i = 0; i < argv.length; i++) {
    const [key, val] = argv[i].includes('=') ? argv[i].split('=', 2) : [argv[i], argv[i + 1]]
    if (!argv[i].includes('=')) i++
    switch (key) {
      case '--url':
        args.url = val?.replace(/\/$/, '')
        break
      case '--chains':
        args.chains = val
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case '--top':
        args.top = Number(val)
        break
      case '--timeout':
        args.timeoutMs = Number(val) * 1000
        break
      case '--limit':
        args.limit = Number(val)
        break
      default:
        console.error(`unknown flag: ${key}`)
        process.exit(2)
    }
  }
  if (!args.url) {
    console.error('--url is required')
    process.exit(2)
  }
  return args as Args
}

type StatsEntry = { chainId: string; chainIdentifier: string; count: number }
type TokenListResponse = { chainId: number; total: number; tokens: unknown[] }

const fetchJson = async <T>(url: string, timeoutMs: number): Promise<{ data: T; elapsed: number }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = performance.now()
  try {
    const res = await fetch(url, { signal: controller.signal })
    const elapsed = performance.now() - start
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as T
    return { data, elapsed }
  } finally {
    clearTimeout(timer)
  }
}

const pad = (s: string | number, n: number) => String(s).padEnd(n)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Target: ${args.url}`)

  // 1. /health
  try {
    const { data, elapsed } = await fetchJson<{ status: string }>(`${args.url}/health`, args.timeoutMs)
    console.log(`  /health              ${pad(Math.round(elapsed) + 'ms', 10)} status=${data.status}`)
    if (data.status !== 'ok') {
      console.error('\n❌ server not ready')
      process.exit(1)
    }
  } catch (err) {
    console.error(`  /health              FAIL  ${(err as Error).message}`)
    process.exit(1)
  }

  // 2. /stats
  let stats: StatsEntry[]
  try {
    const { data, elapsed } = await fetchJson<StatsEntry[]>(`${args.url}/stats`, args.timeoutMs)
    stats = data
    console.log(`  /stats               ${pad(Math.round(elapsed) + 'ms', 10)} ${stats.length} chains`)
  } catch (err) {
    console.error(`  /stats               FAIL  ${(err as Error).message}`)
    process.exit(1)
  }

  // Verify stats is ordered by count DESC
  for (let i = 1; i < stats.length; i++) {
    if (stats[i].count > stats[i - 1].count) {
      console.error(
        `\n❌ /stats not ordered by count DESC: ${stats[i - 1].chainId}=${stats[i - 1].count} before ${stats[i].chainId}=${stats[i].count}`,
      )
      process.exit(1)
    }
  }

  // 3. Pick chains to test
  let toTest: StatsEntry[]
  if (args.chains) {
    const set = new Set(args.chains)
    toTest = stats.filter((s) => set.has(s.chainId))
    const missing = args.chains.filter((c) => !stats.some((s) => s.chainId === c))
    for (const m of missing) {
      console.log(`  chain ${m}             SKIP (not in /stats)`)
    }
  } else {
    toTest = stats.slice(0, args.top)
  }

  // 4. For each chain, hit /list/tokens and compare total to stats count
  let failures = 0
  for (const s of toTest) {
    const label = `/list/tokens/${s.chainId}`
    const url = args.limit ? `${args.url}${label}?limit=${args.limit}` : `${args.url}${label}`
    try {
      const { data, elapsed } = await fetchJson<TokenListResponse>(url, args.timeoutMs)
      const mismatch = data.total !== s.count
      const tag = mismatch ? `❌ MISMATCH (stats=${s.count} vs total=${data.total})` : '✓'
      console.log(`  ${pad(label, 20)} ${pad(Math.round(elapsed) + 'ms', 10)} total=${data.total}  ${tag}`)
      if (mismatch) failures++
    } catch (err) {
      console.error(`  ${pad(label, 20)} FAIL  ${(err as Error).message}`)
      failures++
    }
  }

  console.log()
  if (failures) {
    console.error(`❌ ${failures} check(s) failed`)
    process.exit(1)
  }
  console.log(`✅ all ${toTest.length} chain(s) passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
