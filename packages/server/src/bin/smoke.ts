#!/usr/bin/env tsx
/**
 * HTTP smoke tester for a running server (local, staging, or production).
 * Covers health, stats ordering, stats-vs-list-total parity per chain, core
 * endpoints (/networks, /list), and the image pipeline (format conversion +
 * vector filtering against a known token).
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
    // Split at the FIRST '=' only — String.split's limit truncates and would discard
    // the remainder of values containing '=' (e.g. --url with a query string).
    const eqIndex = argv[i].indexOf('=')
    const [key, val] = eqIndex === -1 ? [argv[i], argv[i + 1]] : [argv[i].slice(0, eqIndex), argv[i].slice(eqIndex + 1)]
    if (eqIndex === -1) i++
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

const fetchStatus = async (
  url: string,
  timeoutMs: number,
): Promise<{ status: number; contentType: string; elapsed: number }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = performance.now()
  try {
    const res = await fetch(url, { signal: controller.signal })
    // Drain the body so keep-alive sockets are reusable
    await res.arrayBuffer()
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      elapsed: performance.now() - start,
    }
  } finally {
    clearTimeout(timer)
  }
}

// A token expected to exist with an image on any populated deployment — used to
// exercise the image pipeline (default, format conversion, vector filter).
const IMAGE_PROBE_CHAIN = '1'
const IMAGE_PROBE_TOKEN = '0xdAC17F958D2ee523a2206206994597C13D831ec7' // USDT on Ethereum

type EndpointCase = { label: string; path: string; expectContentType?: string }

const endpointCases = (haveEthereum: boolean): EndpointCase[] => [
  { label: '/networks', path: '/networks' },
  { label: '/list', path: '/list' },
  ...(haveEthereum
    ? [
        { label: 'image (default)', path: `/image/${IMAGE_PROBE_CHAIN}/${IMAGE_PROBE_TOKEN}` },
        {
          label: 'image (as=webp)',
          path: `/image/${IMAGE_PROBE_CHAIN}/${IMAGE_PROBE_TOKEN}?as=webp`,
          expectContentType: 'image/webp',
        },
        {
          label: 'image (as=png)',
          path: `/image/${IMAGE_PROBE_CHAIN}/${IMAGE_PROBE_TOKEN}?as=png`,
          expectContentType: 'image/png',
        },
        { label: 'image (only=vector)', path: `/image/${IMAGE_PROBE_CHAIN}/${IMAGE_PROBE_TOKEN}?only=vector` },
        { label: 'chain image', path: `/image/${IMAGE_PROBE_CHAIN}` },
      ]
    : []),
]

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

  // 4. Endpoint + image-pipeline checks (image probes need Ethereum data to exist)
  let failures = 0
  const haveEthereum = stats.some((s) => s.chainId === IMAGE_PROBE_CHAIN)
  if (!haveEthereum) {
    console.log(`  image checks         SKIP (chain ${IMAGE_PROBE_CHAIN} not in /stats)`)
  }
  for (const c of endpointCases(haveEthereum)) {
    try {
      const { status, contentType, elapsed } = await fetchStatus(`${args.url}${c.path}`, args.timeoutMs)
      const problems: string[] = []
      if (status !== 200) problems.push(`status ${status}`)
      if (c.expectContentType && !contentType.startsWith(c.expectContentType)) {
        problems.push(`content-type "${contentType}" (expected ${c.expectContentType})`)
      }
      const tag = problems.length ? `❌ ${problems.join(', ')}` : '✓'
      console.log(`  ${pad(c.label, 20)} ${pad(Math.round(elapsed) + 'ms', 10)} ${tag}`)
      if (problems.length) failures++
    } catch (err) {
      console.error(`  ${pad(c.label, 20)} FAIL  ${(err as Error).message}`)
      failures++
    }
  }

  // 5. OpenAPI definition + every GET x-example it documents.
  // The docs page renders from this document and probes these exact URLs, so
  // a broken example here means a broken "try it" card in the docs.
  try {
    const { data: spec, elapsed } = await fetchJson<{
      openapi: string
      paths: Record<string, Record<string, { 'x-example'?: string }>>
    }>(`${args.url}/openapi.json`, args.timeoutMs)
    console.log(`  /openapi.json        ${pad(Math.round(elapsed) + 'ms', 10)} openapi=${spec.openapi}`)
    const examples = Object.values(spec.paths)
      .flatMap((methods) => (methods.get?.['x-example'] ? [methods.get['x-example']] : []))
      .filter((example) => example !== '/openapi.json')
    for (const example of examples) {
      try {
        const { status, elapsed } = await fetchStatus(`${args.url}${example}`, args.timeoutMs)
        const ok = status === 200 || status === 204
        console.log(
          `  ${pad(`example ${example.split('?')[0]}`, 20)} ${pad(Math.round(elapsed) + 'ms', 10)} ${ok ? '✓' : `❌ status ${status}`}`,
        )
        if (!ok) failures++
      } catch (err) {
        console.error(`  ${pad(`example ${example.split('?')[0]}`, 20)} FAIL  ${(err as Error).message}`)
        failures++
      }
    }
  } catch (err) {
    console.error(`  /openapi.json        FAIL  ${(err as Error).message}`)
    failures++
  }

  // 6. For each chain, hit /list/tokens and compare total to stats count.
  // The list body is served from a stale-while-revalidate cache (up to 6h fresh)
  // while /stats refreshes hourly, so on actively-collected chains the two
  // legitimately drift by a handful of tokens. Tiny drift warns; real divergence
  // (the predicate-mismatch bug class this check exists for) still fails.
  const DRIFT_TOLERANCE = 0.005 // 0.5%
  for (const s of toTest) {
    const label = `/list/tokens/${s.chainId}`
    const url = args.limit ? `${args.url}${label}?limit=${args.limit}` : `${args.url}${label}`
    try {
      const { data, elapsed } = await fetchJson<TokenListResponse>(url, args.timeoutMs)
      const drift = Math.abs(data.total - s.count)
      const withinTolerance = drift <= Math.max(1, Math.round(s.count * DRIFT_TOLERANCE))
      const tag =
        drift === 0
          ? '✓'
          : withinTolerance
            ? `⚠ drift ${drift} (stats=${s.count} vs total=${data.total} — cache windows, not a logic mismatch)`
            : `❌ MISMATCH (stats=${s.count} vs total=${data.total})`
      console.log(`  ${pad(label, 20)} ${pad(Math.round(elapsed) + 'ms', 10)} total=${data.total}  ${tag}`)
      if (drift > 0 && !withinTolerance) failures++
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
  console.log(`✅ all checks passed (${toTest.length} chain(s) + endpoint/image probes)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
