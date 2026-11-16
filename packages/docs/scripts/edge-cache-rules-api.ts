/**
 * @module edge-cache-rules-api
 * The network and file steps of the edge cache export: read the live rules from Cloudflare, write
 * the committed files, and compare the live rules with the committed file.
 *
 * The zone and the API token come only from the environment. Nothing here prints the token, and the
 * errors name the variable that is missing, never its value. The fetch function is passed in, so the
 * tests run without a network.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { writeJson } from './write-json.ts'
import { extractMarkedBlock, renderRulesBlock, replaceMarkedBlock } from './edge-cache-page.ts'
import {
  compareRuleSets,
  CACHE_SETTINGS_PHASE,
  readEntrypointRules,
  sanitizeRuleSet,
  type EdgeCacheRuleSet,
} from './edge-cache-rules.ts'

/** The Cloudflare API address. */
export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

/** The zone and token that the export reads. */
export interface CloudflareSettings {
  zoneId: string
  apiToken: string
}

/** The part of `fetch` that the export uses. Tests pass a fake. */
export type FetchFunction = (url: string, init: { headers: Record<string, string> }) => Promise<FetchResponse>

/** The part of a fetch response that the export uses. */
export interface FetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

/** Where the committed files live. */
export interface EdgeCachePaths {
  /** The committed rule set, as JSON. */
  rulesFile: string
  /** The caching page, whose generated part is rewritten on export. */
  pageFile: string
}

/**
 * Read the zone and token from an environment object.
 *
 * @param environment The environment, normally `process.env`.
 * @throws When either variable is missing or empty. The message names the variable only.
 */
export const readCloudflareSettings = (environment: Record<string, string | undefined>): CloudflareSettings => {
  const zoneId = environment['CLOUDFLARE_ZONE_ID']
  const apiToken = environment['CLOUDFLARE_API_TOKEN']
  if (!zoneId) throw new Error('CLOUDFLARE_ZONE_ID is not set')
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is not set')
  return { zoneId, apiToken }
}

/**
 * The address of the cache settings ruleset for a zone.
 *
 * @returns The entrypoint address, with the zone identifier encoded for the path.
 */
export const entrypointUrl = (zoneId: string): string =>
  `${CLOUDFLARE_API_BASE}/zones/${encodeURIComponent(zoneId)}/rulesets/phases/${CACHE_SETTINGS_PHASE}/entrypoint`

/**
 * Read the body of an answer as JSON.
 *
 * @throws When the body is not JSON. The status is named; the body is not echoed.
 */
const readBody = async (response: FetchResponse): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    throw new Error(`Cloudflare answered HTTP ${response.status} with a body that is not JSON`)
  }
}

/**
 * Fetch the live cache rules for the zone and sanitize them.
 *
 * @throws When Cloudflare answers with an error status, or the answer does not match what the export expects.
 */
export const fetchLiveRuleSet = async (options: {
  settings: CloudflareSettings
  fetchFunction: FetchFunction
}): Promise<EdgeCacheRuleSet> => {
  const response = await options.fetchFunction(entrypointUrl(options.settings.zoneId), {
    headers: { Authorization: `Bearer ${options.settings.apiToken}`, Accept: 'application/json' },
  })
  const body = await readBody(response)
  if (!response.ok) {
    readEntrypointRules(body)
    throw new Error(`Cloudflare answered HTTP ${response.status}`)
  }
  return sanitizeRuleSet(readEntrypointRules(body))
}

/**
 * Read the committed rule set from its JSON text.
 *
 * @throws When the text is not JSON, or the JSON has no list of rules.
 */
export const readCommittedRuleSet = (text: string): EdgeCacheRuleSet => {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('rules' in parsed) || !Array.isArray(parsed.rules)) {
    throw new Error('the committed rules file has no list of rules')
  }
  return parsed as EdgeCacheRuleSet
}

/**
 * Fetch the live rules, write the committed rules file, and rewrite the generated part of the page.
 *
 * @returns The number of rules written.
 */
export const exportEdgeCacheRules = async (options: {
  settings: CloudflareSettings
  fetchFunction: FetchFunction
  paths: EdgeCachePaths
}): Promise<number> => {
  const live = await fetchLiveRuleSet(options)
  const pageSource = await readFile(options.paths.pageFile, 'utf8')
  const page = replaceMarkedBlock(pageSource, renderRulesBlock(live))
  await writeJson(options.paths.rulesFile, live)
  await writeFile(options.paths.pageFile, page)
  return live.rules.length
}

/**
 * Compare the live rules with the committed rules file.
 *
 * @returns One line per difference. An empty list means the committed file is current.
 */
export const checkEdgeCacheRules = async (options: {
  settings: CloudflareSettings
  fetchFunction: FetchFunction
  paths: EdgeCachePaths
}): Promise<string[]> => {
  const live = await fetchLiveRuleSet(options)
  const committed = readCommittedRuleSet(await readFile(options.paths.rulesFile, 'utf8'))
  return compareRuleSets(committed, live)
}

/**
 * Check that the generated part of the page matches the committed rules file.
 *
 * @returns `true` when the page's table and expressions are what the committed file would draw.
 */
export const isPageBlockCurrent = async (paths: EdgeCachePaths): Promise<boolean> => {
  const committed = readCommittedRuleSet(await readFile(paths.rulesFile, 'utf8'))
  const pageSource = await readFile(paths.pageFile, 'utf8')
  return extractMarkedBlock(pageSource) === renderRulesBlock(committed)
}
