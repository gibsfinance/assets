/**
 * @module edge-cache-rules
 * The gib.show edge cache rules in the reduced form that is committed to the repository.
 *
 * Cloudflare's answer carries identifiers, version numbers and timestamps that mean nothing to a
 * reader and change on every edit. This module keeps only the settings that decide how long a
 * response may be kept, and refuses any setting it does not know. A new setting therefore makes the
 * export fail and name the setting, rather than slip into the committed file unnoticed.
 *
 * Every function here is pure: no network and no file access. The network and file steps are in
 * `edge-cache-rules-api.ts`.
 */

/** A lifetime mode. `respect_origin` keeps the server's own `Cache-Control`; `override_origin` replaces it. */
export type LifetimeMode = 'respect_origin' | 'override_origin'

/** A lifetime for one status code, in whole seconds. */
export interface StatusCodeLifetime {
  code: number
  seconds: number
}

/** How long the edge keeps a response. Status code lifetimes apply to answers with that code. */
export type EdgeLifetime =
  | { mode: 'respect_origin'; statusCodes: StatusCodeLifetime[] }
  | { mode: 'override_origin'; seconds: number; statusCodes: StatusCodeLifetime[] }

/** How long a browser keeps a response. */
export type BrowserLifetime = { mode: 'respect_origin' } | { mode: 'override_origin'; seconds: number }

/** One cache rule, as committed. Only the settings that decide caching are kept. */
export interface EdgeCacheRule {
  /** The rule's name in the dashboard. Unique within a rule set. */
  description: string
  enabled: boolean
  /** The Cloudflare expression that selects the requests the rule applies to. */
  expression: string
  /** Whether the edge keeps responses for the selected requests at all. */
  cacheEnabled: boolean
  /** The edge lifetime. `undefined` when the rule does not set one, so the origin decides. */
  edge?: EdgeLifetime
  /** The browser lifetime. `undefined` when the rule does not set one, so the origin decides. */
  browser?: BrowserLifetime
}

/** The committed rule set: every rule, sorted by name. */
export interface EdgeCacheRuleSet {
  rules: EdgeCacheRule[]
}

/** Keys of a rule that carry no caching meaning. They are read and then dropped. */
const RULE_METADATA_KEYS = ['id', 'ref', 'version', 'last_updated', 'logging', 'categories'] as const
const RULE_KEYS = ['description', 'enabled', 'expression', 'action', 'action_parameters'] as const
const ACTION_PARAMETER_KEYS = ['cache', 'edge_ttl', 'browser_ttl'] as const
const EDGE_TTL_KEYS = ['mode', 'default', 'status_code_ttl'] as const
const STATUS_CODE_KEYS = ['status_code', 'value'] as const
const BROWSER_TTL_KEYS = ['mode', 'default'] as const
const EDGE_MODES = ['respect_origin', 'override_origin'] as const
const BROWSER_MODES = ['respect_origin', 'override_origin'] as const
/** The only action the export understands. Any other action would not be a cache setting. */
const SET_CACHE_SETTINGS = 'set_cache_settings'
/** The phase the cache rules live in. The export refuses an answer for any other phase. */
export const CACHE_SETTINGS_PHASE = 'http_request_cache_settings'

/** Whether a value is a plain object (not an array and not null). */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Throw when an object holds a key outside the allowed list. The message names the keys and says
 * where to add them, so a new Cloudflare setting stops the export instead of being dropped quietly.
 *
 * @param record The object to check.
 * @param allowedKeys Every key the export knows.
 * @param where A short name for the object, used in the message.
 */
const assertOnlyKeys = (record: Record<string, unknown>, allowedKeys: readonly string[], where: string): void => {
  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.includes(key))
  if (unknownKeys.length === 0) return
  throw new Error(
    `${where} has settings this export does not know: ${unknownKeys.join(', ')}. Add them to edge-cache-rules.ts before exporting.`,
  )
}

/** Read a string field, or throw naming the field. */
const readString = (record: Record<string, unknown>, field: string, where: string): string => {
  const value = record[field]
  if (typeof value === 'string') return value
  throw new Error(`${where}: ${field} is not a string`)
}

/** Read a true or false field, or throw naming the field. */
const readBoolean = (record: Record<string, unknown>, field: string, where: string): boolean => {
  const value = record[field]
  if (typeof value === 'boolean') return value
  throw new Error(`${where}: ${field} is not true or false`)
}

/**
 * Read a whole, non-negative number.
 *
 * @param value The raw value.
 * @param name The field name, used in the message.
 * @param where The object the field belongs to, used in the message.
 */
const readWholeNumber = (value: unknown, name: string, where: string): number => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new Error(`${where}: ${name} is not a whole number of zero or more`)
}

/**
 * Read a mode, which must be one of the listed modes.
 *
 * @param value The raw value.
 * @param modes The modes this setting accepts.
 * @param where The setting, used in the message.
 */
const readMode = <Mode extends string>(value: unknown, modes: readonly Mode[], where: string): Mode => {
  const mode = modes.find((candidate) => candidate === value)
  if (mode !== undefined) return mode
  throw new Error(`${where}: mode ${JSON.stringify(value)} is not one of ${modes.join(', ')}`)
}

/** Sort status code lifetimes by code. */
const byStatusCode = (left: StatusCodeLifetime, right: StatusCodeLifetime): number => left.code - right.code

/**
 * Read the `status_code_ttl` list. A missing list means no status code lifetimes.
 *
 * @throws When an entry is malformed or a status code appears twice.
 */
const readStatusCodes = (raw: unknown, where: string): StatusCodeLifetime[] => {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error(`${where}: status_code_ttl is not a list`)
  const lifetimes = raw.map((entry): StatusCodeLifetime => {
    if (!isRecord(entry)) throw new Error(`${where}: a status code lifetime is not an object`)
    assertOnlyKeys(entry, STATUS_CODE_KEYS, `${where} status code lifetime`)
    return {
      code: readWholeNumber(entry.status_code, 'status_code', where),
      seconds: readWholeNumber(entry.value, 'value', where),
    }
  })
  const distinctCodes = new Set(lifetimes.map((lifetime) => lifetime.code))
  if (distinctCodes.size !== lifetimes.length) throw new Error(`${where}: a status code is listed twice`)
  return lifetimes.sort(byStatusCode)
}

/**
 * Read an edge lifetime (the `edge_ttl` setting). An override needs its `default` seconds.
 *
 * @throws When the object has an unknown key, an unknown mode, or an override without seconds.
 */
const readEdgeLifetime = (raw: unknown, where: string): EdgeLifetime => {
  if (!isRecord(raw)) throw new Error(`${where}: edge_ttl is not an object`)
  assertOnlyKeys(raw, EDGE_TTL_KEYS, `${where} edge_ttl`)
  const mode = readMode(raw.mode, EDGE_MODES, `${where} edge_ttl`)
  const statusCodes = readStatusCodes(raw.status_code_ttl, where)
  if (mode === 'override_origin') {
    return { mode, seconds: readWholeNumber(raw.default, 'default', `${where} edge_ttl`), statusCodes }
  }
  return { mode, statusCodes }
}

/**
 * Read a browser lifetime (the `browser_ttl` setting). An override needs its `default` seconds.
 *
 * @throws When the object has an unknown key, an unknown mode, or an override without seconds.
 */
const readBrowserLifetime = (raw: unknown, where: string): BrowserLifetime => {
  if (!isRecord(raw)) throw new Error(`${where}: browser_ttl is not an object`)
  assertOnlyKeys(raw, BROWSER_TTL_KEYS, `${where} browser_ttl`)
  const mode = readMode(raw.mode, BROWSER_MODES, `${where} browser_ttl`)
  if (mode === 'override_origin') {
    return { mode, seconds: readWholeNumber(raw.default, 'default', `${where} browser_ttl`) }
  }
  return { mode }
}

/**
 * Turn one rule from Cloudflare's answer into the committed form.
 *
 * @param raw One entry of the ruleset's `rules` list.
 * @throws When the rule has a setting this export does not know, or a value of the wrong kind.
 */
export const sanitizeRule = (raw: unknown): EdgeCacheRule => {
  if (!isRecord(raw)) throw new Error('a rule is not an object')
  const description = readString(raw, 'description', 'a rule')
  const where = `rule "${description}"`
  assertOnlyKeys(raw, [...RULE_KEYS, ...RULE_METADATA_KEYS], where)
  if (raw.action !== SET_CACHE_SETTINGS) {
    throw new Error(`${where}: action is ${JSON.stringify(raw.action)}, not ${SET_CACHE_SETTINGS}`)
  }
  const parameters = raw.action_parameters
  if (!isRecord(parameters)) throw new Error(`${where}: action_parameters is not an object`)
  assertOnlyKeys(parameters, ACTION_PARAMETER_KEYS, `${where} action_parameters`)
  return {
    description,
    enabled: readBoolean(raw, 'enabled', where),
    expression: readString(raw, 'expression', where),
    cacheEnabled: readBoolean(parameters, 'cache', where),
    ...(parameters.edge_ttl === undefined ? {} : { edge: readEdgeLifetime(parameters.edge_ttl, where) }),
    ...(parameters.browser_ttl === undefined ? {} : { browser: readBrowserLifetime(parameters.browser_ttl, where) }),
  }
}

/**
 * Compare two strings by code unit, so the order never depends on the locale. The inputs must differ,
 * which the callers guarantee because rule names are unique.
 */
const compareText = (left: string, right: string): number => (left < right ? -1 : 1)

/** Sort rules by name, so the committed file keeps the same order on every export. */
const byName = (left: EdgeCacheRule, right: EdgeCacheRule): number => compareText(left.description, right.description)

/**
 * Turn Cloudflare's list of rules into the committed rule set. Rules come out sorted by name.
 *
 * @param rules The `rules` list of the ruleset.
 * @throws When the list is not a list, a rule is malformed, or two rules share a name.
 */
export const sanitizeRuleSet = (rules: unknown): EdgeCacheRuleSet => {
  if (!Array.isArray(rules)) throw new Error('the ruleset has no list of rules')
  const sanitized = rules.map(sanitizeRule)
  const distinctNames = new Set(sanitized.map((rule) => rule.description))
  if (distinctNames.size !== sanitized.length) {
    throw new Error('two rules share a description; rule names must be unique for the export')
  }
  return { rules: sanitized.sort(byName) }
}

/** The text of one entry in Cloudflare's `errors` list, or a fixed phrase when there is none. */
const errorText = (entry: unknown): string => {
  if (isRecord(entry) && typeof entry.message === 'string') return entry.message
  return 'no detail given'
}

/**
 * Take the rules out of Cloudflare's answer to the entrypoint request, checking that it is a
 * successful answer for the cache settings phase.
 *
 * @param body The parsed JSON body of the answer.
 * @returns The `rules` list, not yet sanitized.
 * @throws When Cloudflare refused the request, the answer has no result, or the phase is another one.
 */
export const readEntrypointRules = (body: unknown): unknown => {
  if (!isRecord(body)) throw new Error('Cloudflare answered with something that is not a JSON object')
  if (body.success !== true) {
    const errors = Array.isArray(body.errors) ? body.errors.map(errorText).join('; ') : 'no detail given'
    throw new Error(`Cloudflare refused the request: ${errors}`)
  }
  if (!isRecord(body.result)) throw new Error('Cloudflare answered without a result')
  if (body.result.phase !== CACHE_SETTINGS_PHASE) {
    throw new Error(`the entrypoint is for phase ${JSON.stringify(body.result.phase)}, not ${CACHE_SETTINGS_PHASE}`)
  }
  return body.result.rules
}

/**
 * Describe the differences between a committed rule set and the live one, in plain sentences.
 *
 * @returns One line per difference. An empty list means the two match.
 */
export const compareRuleSets = (committed: EdgeCacheRuleSet, live: EdgeCacheRuleSet): string[] => {
  const committedByName = new Map(committed.rules.map((rule) => [rule.description, rule]))
  const liveByName = new Map(live.rules.map((rule) => [rule.description, rule]))
  const names = [...new Set([...committedByName.keys(), ...liveByName.keys()])].sort(compareText)
  return names.flatMap((name) =>
    describeRuleDifference({ name, committed: committedByName.get(name), live: liveByName.get(name) }),
  )
}

/** The settings that `compareRuleSets` looks at, in the order it reports them. */
const COMPARED_FIELDS = ['enabled', 'expression', 'cacheEnabled', 'edge', 'browser'] as const

/**
 * Describe how one rule differs between the committed file and the live rules.
 *
 * @returns No lines when the rule matches, otherwise one line per changed setting or a line for a rule
 *   that exists on only one side.
 */
const describeRuleDifference = (options: {
  name: string
  committed: EdgeCacheRule | undefined
  live: EdgeCacheRule | undefined
}): string[] => {
  const { name, committed, live } = options
  if (committed === undefined) return [`rule "${name}" is live but not committed`]
  if (live === undefined) return [`rule "${name}" is committed but not live`]
  return COMPARED_FIELDS.filter((field) => JSON.stringify(committed[field]) !== JSON.stringify(live[field])).map(
    (field) =>
      `rule "${name}": ${field} is ${JSON.stringify(committed[field])} in the committed file and ${JSON.stringify(live[field])} live`,
  )
}

/** Plain words for a lifetime that the origin decides, used where a rule sets none. */
const ORIGIN_DECIDES = "Not set by this rule, so the origin's Cache-Control header decides"

/** Plain words for an edge lifetime. */
export const describeEdgeLifetime = (rule: EdgeCacheRule): string => {
  if (!rule.cacheEnabled) return 'Not kept at the edge'
  if (rule.edge === undefined) return ORIGIN_DECIDES
  const base =
    rule.edge.mode === 'override_origin'
      ? `${rule.edge.seconds} seconds, whatever the origin says`
      : "Follows the origin's Cache-Control header"
  const exceptions = rule.edge.statusCodes.map(
    (lifetime) => `${lifetime.code} answers are kept ${lifetime.seconds} seconds`,
  )
  if (exceptions.length === 0) return base
  return `${base}, except ${exceptions.join(' and ')}`
}

/** Plain words for a browser lifetime. */
export const describeBrowserLifetime = (rule: EdgeCacheRule): string => {
  if (rule.browser === undefined) return ORIGIN_DECIDES
  if (rule.browser.mode === 'override_origin') return `${rule.browser.seconds} seconds, whatever the origin says`
  return "Follows the origin's Cache-Control header"
}
