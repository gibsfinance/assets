#!/usr/bin/env node
/**
 * Build curated conveyor icon list.
 * Checks each image >= 64x64 or SVG.
 */

const BASE = process.env.BASE_URL || 'https://staging.gib.show'
const MIN = 64
const CONC = 20
const TARGET = 450

function pngD(b) { return b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null }
function jpgD(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let o = 2
  while (o < b.length - 9) {
    if (b[o] !== 0xff) { o++; continue }
    const m = b[o+1]
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xcf && m !== 0xc8))
      return { w: b.readUInt16BE(o+7), h: b.readUInt16BE(o+5) }
    if (o+3 >= b.length) return null
    o += 2 + b.readUInt16BE(o+2)
  }
  return null
}
function gifD(b) { return b.length >= 10 && b.slice(0,3).toString('ascii') === 'GIF' ? { w: b.readUInt16LE(6), h: b.readUInt16LE(8) } : null }
function webpD(b) {
  if (b.length < 16 || b.slice(0,4).toString('ascii') !== 'RIFF' || b.slice(8,12).toString('ascii') !== 'WEBP') return null
  const c = b.slice(12,16).toString('ascii')
  if (c === 'VP8 ' && b.length >= 30) return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
  if (c === 'VP8L' && b.length >= 25) { const bits = b.readUInt32LE(21); return { w: (bits & 0x3fff)+1, h: ((bits>>14) & 0x3fff)+1 } }
  if (c === 'VP8X' && b.length >= 30) return { w: 1+(b[24]|(b[25]<<8)|(b[26]<<16)), h: 1+(b[27]|(b[28]<<8)|(b[29]<<16)) }
  return null
}

function ok(buf, ct) {
  if (ct?.includes('svg')) return true
  const d = pngD(buf) || jpgD(buf) || gifD(buf) || webpD(buf)
  return d && d.w >= MIN && d.h >= MIN
}

async function check(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10000) })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (ct.includes('svg')) return path
    const buf = Buffer.from(await r.arrayBuffer())
    return ok(buf, ct) ? path : null
  } catch { return null }
}

async function batchCheck(paths, seen) {
  const todo = paths.filter(p => !seen.has(p))
  const good = []
  for (let i = 0; i < todo.length; i += CONC) {
    const r = await Promise.all(todo.slice(i, i+CONC).map(check))
    good.push(...r.filter(Boolean))
  }
  return good
}

async function get(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(60000) })
    return r.ok ? r.json() : null
  } catch { return null }
}

// Known good lists with provider/key combos (discovered from /list API)
const LISTS = [
  // PulseChain — best quality images
  { chainId: '369', provider: 'piteas', key: 'exchange' },
  { chainId: '369', provider: 'pls369', key: 'repo' },
  { chainId: '369', provider: 'midgard', key: 'all' },
  // Ethereum
  { chainId: '1', provider: 'trustwallet', key: 'wallet-ethereum' },
  { chainId: '1', provider: 'uniswap-synthetix', key: 'hosted' },
  { chainId: '1', provider: 'uniswap-wrapped-tokens', key: 'hosted' },
  { chainId: '1', provider: 'uniswap-cmc-defi', key: 'hosted' },
  { chainId: '1', provider: 'smoldapp', key: 'tokenlist-1' },
  { chainId: '1', provider: 'coingecko', key: 'ethereum' },
  // Base
  { chainId: '8453', provider: 'smoldapp', key: 'tokenlist-8453' },
  { chainId: '8453', provider: 'coingecko', key: 'base' },
  // Arbitrum
  { chainId: '42161', provider: 'smoldapp', key: 'tokenlist-42161' },
  { chainId: '42161', provider: 'coingecko', key: 'arbitrum-one' },
  // Polygon
  { chainId: '137', provider: 'smoldapp', key: 'tokenlist-137' },
  { chainId: '137', provider: 'coingecko', key: 'polygon-pos' },
  // BNB
  { chainId: '56', provider: 'smoldapp', key: 'tokenlist-56' },
  { chainId: '56', provider: 'coingecko', key: 'binance-smart-chain' },
  // Optimism
  { chainId: '10', provider: 'smoldapp', key: 'tokenlist-10' },
  { chainId: '10', provider: 'coingecko', key: 'optimistic-ethereum' },
  // Avalanche
  { chainId: '43114', provider: 'smoldapp', key: 'tokenlist-43114' },
  { chainId: '43114', provider: 'coingecko', key: 'avalanche' },
  // Sonic (146)
  { chainId: '146', provider: 'coingecko', key: 'sonic' },
  // zkSync (324)
  { chainId: '324', provider: 'coingecko', key: 'zksync' },
  // Berachain (80094)
  { chainId: '80094', provider: 'coingecko', key: 'berachain' },
]

async function main() {
  const passed = new Set()

  // 1. Network icons — use known chain IDs
  process.stderr.write('Networks...')
  const nets = await get('/networks')
  if (nets) {
    const paths = nets.filter(n => n.imageHash).map(n => `/image/${n.chainId}`)
    const good = await batchCheck(paths, passed)
    for (const p of good) passed.add(p)
  }
  console.error(` ${passed.size}`)

  // 2. Token lists
  for (const { chainId, provider, key } of LISTS) {
    if (passed.size >= TARGET) break
    const url = `/list/${provider}/${key}?chainId=${chainId}`
    process.stderr.write(`  ${chainId} ${provider}/${key}...`)
    const data = await get(url)
    if (!data?.tokens) { console.error(' skip'); continue }

    const paths = data.tokens
      .slice(0, 150)
      .map(t => `/image/${chainId}/${t.address.toLowerCase()}`)
      .filter(p => !passed.has(p))

    if (!paths.length) { console.error(' 0 new'); continue }
    const good = await batchCheck(paths, passed)
    for (const p of good) passed.add(p)
    console.error(` +${good.length} = ${passed.size}`)
  }

  const curated = [...passed].sort()
  console.error(`\n=== ${curated.length} curated icons ===`)

  console.log(`// ${curated.length} curated icons (>=${MIN}x${MIN} or SVG)`)
  console.log(`// Generated: ${new Date().toISOString().split('T')[0]}`)
  console.log(`const ICON_PATHS: string[] = [`)
  for (const p of curated) console.log(`  '${p}',`)
  console.log(`]`)
}

main()
