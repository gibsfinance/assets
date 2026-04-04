#!/usr/bin/env node
/**
 * Scan the staging API for high-quality token icons across all chains.
 * Fetches tokens from multiple lists per chain, checks image dimensions,
 * outputs a curated list of icons >= 64x64 or SVG.
 */

const BASE_URL = process.env.BASE_URL || 'https://staging.gib.show'
const MIN_DIM = 64
const CONCURRENCY = 15
const TARGET_COUNT = 450

// Dimension parsers
function pngDimensions(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let offset = 2
  while (offset < buf.length - 9) {
    if (buf[offset] !== 0xff) { offset++; continue }
    const marker = buf[offset + 1]
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) }
    }
    if (offset + 3 >= buf.length) return null
    offset += 2 + buf.readUInt16BE(offset + 2)
  }
  return null
}

function gifDimensions(buf) {
  if (buf.length < 10 || buf.slice(0, 3).toString('ascii') !== 'GIF') return null
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
}

function webpDimensions(buf) {
  if (buf.length < 30) return null
  if (buf.slice(0, 4).toString('ascii') !== 'RIFF' || buf.slice(8, 12).toString('ascii') !== 'WEBP') return null
  const chunk = buf.slice(12, 16).toString('ascii')
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
    return { width: w, height: h }
  }
  return null
}

function getDimensions(buf, contentType) {
  if (contentType?.includes('svg')) return { width: Infinity, height: Infinity }
  return pngDimensions(buf) || jpegDimensions(buf) || gifDimensions(buf) || webpDimensions(buf)
}

async function checkImage(path) {
  const url = `${BASE_URL}${path}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('svg')) return { path, format: 'svg' }
    const buf = Buffer.from(await res.arrayBuffer())
    const dims = getDimensions(buf, ct)
    if (!dims) return null
    if (dims.width >= MIN_DIM && dims.height >= MIN_DIM) {
      return { path, format: ct.split('/')[1], width: dims.width, height: dims.height }
    }
    return null
  } catch {
    return null
  }
}

async function fetchJSON(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function runBatch(items, fn) {
  const results = []
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY)
    const r = await Promise.all(batch.map(fn))
    results.push(...r)
  }
  return results
}

async function main() {
  const passed = new Set()

  // 1. Network icons — all chains from /networks
  console.error('Fetching network list...')
  const networks = await fetchJSON('/networks')
  if (networks) {
    const networkPaths = networks.map(n => `/image/${n.chainId || n}`)
    console.error(`Checking ${networkPaths.length} network icons...`)
    const results = await runBatch(networkPaths, checkImage)
    for (const r of results) if (r) passed.add(r.path)
    console.error(`  ${passed.size} network icons passed`)
  }

  // 2. Get all lists, group by chain, pick diverse providers
  console.error('Fetching all lists...')
  const allLists = await fetchJSON('/list')
  if (!allLists) { console.error('Failed to fetch lists'); process.exit(1) }

  // Group lists by chainId
  const listsByChain = new Map()
  for (const list of allLists) {
    const chainId = String(list.chainId ?? list.network?.chainId ?? '')
    if (!chainId || chainId === '0') continue
    if (!listsByChain.has(chainId)) listsByChain.set(chainId, [])
    listsByChain.get(chainId).push(list)
  }

  console.error(`Found ${listsByChain.size} chains with lists`)

  // Priority chains for diversity
  const priorityChains = ['1', '369', '42161', '137', '56', '8453', '10', '43114', '146', '324', '250', '534352', '59144', '81457', '1284', '130', '80094']

  // For each chain, fetch tokens from a couple lists and check images
  for (const chainId of priorityChains) {
    if (passed.size >= TARGET_COUNT) break

    const lists = listsByChain.get(chainId)
    if (!lists || lists.length === 0) continue

    // Pick up to 3 lists per chain (prefer non-coingecko for better image quality)
    const nonCG = lists.filter(l => !String(l.providerKey || '').includes('coingecko'))
    const cg = lists.filter(l => String(l.providerKey || '').includes('coingecko'))
    const picks = [...nonCG.slice(0, 2), ...cg.slice(0, 1)].slice(0, 3)

    for (const list of picks) {
      if (passed.size >= TARGET_COUNT) break

      const pKey = list.providerKey || list.provider?.key
      const lKey = list.listKey || list.key
      if (!pKey || !lKey) continue

      console.error(`\n  Chain ${chainId}: ${pKey}/${lKey}`)
      const listData = await fetchJSON(`/list/${pKey}/${lKey}`)
      if (!listData || !listData.tokens) continue

      const tokens = listData.tokens.slice(0, 80) // cap per list
      const paths = tokens.map(t => `/image/${chainId}/${t.address}`)
        .filter(p => !passed.has(p))

      if (paths.length === 0) continue
      console.error(`    Checking ${paths.length} token images...`)

      const results = await runBatch(paths, checkImage)
      let added = 0
      for (const r of results) {
        if (r && !passed.has(r.path)) {
          passed.add(r.path)
          added++
        }
      }
      console.error(`    +${added} passed (total: ${passed.size})`)
    }
  }

  const curated = [...passed].sort()
  console.error(`\n=== Final: ${curated.length} curated icons ===\n`)

  // Output as TypeScript array
  console.log(`// ${curated.length} curated icons (min ${MIN_DIM}x${MIN_DIM}, SVGs always pass)`)
  console.log(`// Generated: ${new Date().toISOString()}`)
  console.log(`const ICON_PATHS: string[] = [`)
  for (const p of curated) {
    console.log(`  '${p}',`)
  }
  console.log(`]`)
}

main()
