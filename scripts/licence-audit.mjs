#!/usr/bin/env node
/**
 * Audit where the artwork in every collected token list lives, and what licence
 * covers it.
 *
 *   node scripts/licence-audit.mjs
 *
 * Needs the GitHub command-line tool (`gh`) signed in, which it uses to read each
 * repository's licence file. Reads only; changes nothing.
 *
 * A repository's licence covers only the files stored in it, so what licenses an
 * image is the repository the IMAGE lives in - not the repository, or the company,
 * that published the list pointing at it. For every list this reports how much of
 * its artwork lives in a repository with a licence file, and then lists every
 * licensed repository found, marking the ones the attribution registry
 * (packages/server/src/server/image/attribution.ts) does not know yet. Those are
 * the candidates: adding one is a single row there.
 *
 * Sources are discovered, not listed by hand: every address in the collectors is
 * fetched, and the ones that answer with a token list are audited. A hand-kept
 * list would quietly fall behind the collectors.
 *
 * "No licence file" means GitHub found none. It does not prove the artwork is
 * unlicensed, only that nothing here says it is licensed - which is the standard
 * the service holds itself to.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const collectDir = path.join(root, 'packages/server/src/collect')
const registryFile = path.join(root, 'packages/server/src/server/image/attribution.ts')
const uniswapRegistry = path.join(root, 'packages/server/src/harvested/uniswap/lists.json')
const headers = { 'User-Agent': 'gib.show licence audit' }
const NOT_A_LICENCE = new Set(['none', 'NOASSERTION', 'unreachable'])

/** Every http(s) address written in a collector, plus the Uniswap registry's lists. */
const discoverSources = () => {
  const addresses = new Map()
  for (const file of readdirSync(collectDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const text = readFileSync(path.join(collectDir, file), 'utf8')
    for (const [address] of text.matchAll(/https?:\/\/[a-zA-Z0-9./_@%-]+/g)) {
      addresses.set(address.replace(/\.$/, ''), file.replace(/\.ts$/, ''))
    }
  }
  for (const [key, item] of Object.entries(JSON.parse(readFileSync(uniswapRegistry, 'utf8')))) {
    const suffixed = key.endsWith('.eth') ? `${key}.link` : key
    addresses.set(suffixed.startsWith('https://') ? suffixed : `https://${suffixed}`, `uniswap/${item.name}`)
  }
  return addresses
}

const fetchJson = async (address) => {
  try {
    const response = await fetch(address, { headers, signal: AbortSignal.timeout(40_000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/** The logo addresses in a token list, or null when the document is not one. */
const logosOf = (document) => {
  const entries = Array.isArray(document?.tokens) ? document.tokens : Array.isArray(document) ? document : null
  if (
    !entries ||
    !entries.some((entry) => entry && typeof entry === 'object' && ('address' in entry || 'img_url' in entry))
  ) {
    return null
  }
  return entries.map((entry) => {
    const logo = entry?.logoURI ?? entry?.img_url ?? entry?.logo
    return typeof logo === 'string' ? logo : typeof logo?.src === 'string' ? logo.src : null
  })
}

const pagesRepositories = new Map()
const gh = (args) => {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** Which GitHub repository an address points into, as `owner/repo`, or null. */
const repositoryOf = (address) => {
  let parsed
  try {
    parsed = new URL(address)
  } catch {
    return null
  }
  const [first, second] = parsed.pathname.split('/').filter(Boolean)
  if (parsed.hostname === 'raw.githubusercontent.com' || parsed.hostname === 'github.com') {
    return first && second ? `${first}/${second}`.toLowerCase() : null
  }
  if (parsed.hostname === 'cdn.jsdelivr.net' && first === 'gh') {
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean).slice(1)
    return owner && repo ? `${owner}/${repo.split('@')[0]}`.toLowerCase() : null
  }
  if (parsed.hostname.endsWith('.github.io')) {
    // owner.github.io/repo/... is that repository's project site when the
    // repository exists; otherwise the path belongs to the owner's own site.
    const owner = parsed.hostname.slice(0, -'.github.io'.length)
    const key = `${owner}/${first}`
    if (!pagesRepositories.has(key))
      pagesRepositories.set(key, first && gh(['api', `repos/${key}`, '--silent']) !== null)
    return (pagesRepositories.get(key) ? key : `${owner}/${owner}.github.io`).toLowerCase()
  }
  return null
}

const licenceOf = (repository) => {
  const found = gh(['api', `repos/${repository}/license`, '--jq', '[.license.spdx_id // "none", .html_url] | @tsv'])
  if (found === null) return { licence: 'none', url: null }
  const [licence, url] = found.trim().split('\t')
  return { licence, url }
}

/** Repositories the attribution registry already knows, read from its source. */
const registeredRepositories = () => {
  const text = readFileSync(registryFile, 'utf8')
  const registered = new Set()
  for (const [, owner, repo] of text.matchAll(/owner:\s*'([^']+)',\s*repo:\s*'([^']+)'/g)) {
    registered.add(`${owner}/${repo}`.toLowerCase())
  }
  for (const known of ['trustwallet/assets', 'smoldapp/tokenassets', 'pls369/pulsechain-assets', '0xa3k5/web3icons']) {
    registered.add(known)
  }
  return registered
}

const sources = discoverSources()
const documents = await Promise.all([...sources.keys()].map(fetchJson))
const lists = []
const imagesByRepository = new Map()
for (const [index, [address, collector]] of [...sources].entries()) {
  const logos = logosOf(documents[index])
  if (!logos) continue
  const byRepository = new Map()
  for (const logo of logos) {
    const repository = logo ? repositoryOf(logo) : null
    if (!repository) continue
    byRepository.set(repository, (byRepository.get(repository) ?? 0) + 1)
    imagesByRepository.set(repository, (imagesByRepository.get(repository) ?? 0) + 1)
  }
  lists.push({ collector, address, total: logos.filter(Boolean).length, byRepository })
}

const licences = new Map([...imagesByRepository.keys()].map((repository) => [repository, licenceOf(repository)]))
const registered = registeredRepositories()
const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '-')

console.log(`Audited ${lists.length} token lists from ${sources.size} addresses in the collectors.\n`)
console.log(`${'list'.padEnd(36)}${'images'.padStart(8)}${'licensed'.padStart(10)}  licensed artwork lives in`)
for (const list of lists.sort((a, b) => b.total - a.total)) {
  const licensed = [...list.byRepository].filter(([repository]) => !NOT_A_LICENCE.has(licences.get(repository).licence))
  const count = licensed.reduce((sum, [, images]) => sum + images, 0)
  const where = licensed
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([repository, images]) => `${repository} (${licences.get(repository).licence}) ${images}`)
    .join('; ')
  console.log(
    `${list.collector.slice(0, 35).padEnd(36)}${String(list.total).padStart(8)}${percent(count, list.total).padStart(10)}  ${where}`,
  )
}

console.log(`\nLicensed repositories holding artwork, by images referenced:`)
for (const [repository, images] of [...imagesByRepository].sort((a, b) => b[1] - a[1])) {
  const { licence, url } = licences.get(repository)
  if (NOT_A_LICENCE.has(licence)) continue
  const status = registered.has(repository) ? 'registered' : 'NOT REGISTERED'
  console.log(
    `  ${String(images).padStart(6)}  ${repository.padEnd(44)} ${licence.padEnd(11)} ${status.padEnd(15)} ${url ?? ''}`,
  )
}
console.log(
  '\nBefore registering one, check that its images really live in the repository - a repository can carry a licence while its',
)
console.log('artwork sits elsewhere, as ethereum-lists/chains does with its icons on IPFS.')
